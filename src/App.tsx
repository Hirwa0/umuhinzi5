import React, { useState, useEffect, useRef, useMemo } from 'react';
import { auth, db, googleProvider } from './lib/firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, limit, addDoc, updateDoc, increment, where, deleteDoc, getDocs, writeBatch, getDocFromServer } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, 
  CloudSun, 
  Camera, 
  ShoppingBag, 
  Users, 
  Settings, 
  LogOut, 
  LogIn,
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX,
  Send,
  Search,
  Plus,
  Heart,
  MessageCircle,
  Share2,
  Sun,
  Moon,
  Globe,
  Globe2,
  ChevronRight,
  Bell,
  TrendingUp,
  TrendingDown,
  Minus,
  Trash2,
  Languages,
  RefreshCw,
  ArrowLeft,
  History,
  Eraser,
  WifiOff,
  Menu,
  X,
  Sprout,
  MapPin,
  CloudRain,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  User as UserIcon
} from 'lucide-react';
import { Language, Theme, Tab, UserProfile, Post, ChatMessage, CropPrice, ChatSession } from './types';
import { APP_NAME, CREATOR_CREDITS, TRANSLATIONS, SAMPLE_MARKET_PRICES, COUNTRIES } from './constants';
import { cn, compressImage } from './lib/utils';
import { callEngine, parseEngineResponse, generateEngineImage, isAiConfigured, Type, ThinkingLevel, resetAiEngine } from './lib/engine';
import { Toaster, toast } from 'sonner';
import Markdown from 'react-markdown';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  rw: 'Kinyarwanda',
  fr: 'French',
  sw: 'Swahili',
  it: 'Italian',
  de: 'German',
  ru: 'Russian',
  es: 'Spanish',
  pt: 'Portuguese',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi'
};

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  
  const errString = JSON.stringify(errInfo);
  console.error("Firestore Error:", errString);

  if (errInfo.error.includes('Missing or insufficient permissions')) {
    throw new Error(errString);
  }
  
  return errInfo;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center p-8 text-center bg-stone-50 dark:bg-zinc-950">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 text-red-600 rounded-2xl flex items-center justify-center mb-6">
            <Settings size={32} />
          </div>
          <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-8">
            We encountered an unexpected error. Please try refreshing the page.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-green-600 text-white px-8 py-3 rounded-full font-bold hover:bg-green-700 transition-colors"
          >
            Refresh App
          </button>
          {process.env.NODE_ENV !== 'production' && (
            <pre className="mt-8 p-4 bg-zinc-100 dark:bg-zinc-900 rounded-xl text-left text-xs overflow-auto max-w-full">
              {this.state.errorInfo}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// --- App Root ---
// Helper to extract user-friendly error messages from AI service errors
const getErrorUserMessage = (error: any, lang: Language = 'en'): string => {
  let errorMsg = error?.message || "An unexpected error occurred.";
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  
  // Robust JSON extraction for embedded error objects
  const jsonMatch = errorMsg.match(/\{.*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      errorMsg = parsed?.error?.message || errorMsg;
    } catch (e) {}
  }
  
  const lowerMsg = errorMsg.toLowerCase();
  
  // Safety filter errors
  if (lowerMsg.includes("safety") || lowerMsg.includes("blocked") || lowerMsg.includes("filters")) {
    return t.aiErrorSafety || "I'm sorry, I cannot process that request as it might violate safety guidelines.";
  }

  // Broad catch-all for various network/quota/capacity issues including user's specific reported error
  const isGenericFailure = lowerMsg.includes("failed to call") || 
                           lowerMsg.includes("gemini api") || 
                           lowerMsg.includes("fetch") || 
                           lowerMsg.includes("network") || 
                           lowerMsg.includes("please try again") ||
                           lowerMsg.includes("unreachable") ||
                           lowerMsg.includes("unresponsive") ||
                           lowerMsg.includes("maintenance") ||
                           lowerMsg.includes("initialization mode") ||
                           lowerMsg.includes("configuration mode");

  if (isGenericFailure) {
    return t.aiBusyRetrying || "The AI system is temporarily unavailable or in configuration mode. We're attempting to reconnect with high-priority protocols. Please try again in 30 seconds.";
  }

  const isHighDemand = lowerMsg.includes("busy") || 
                        lowerMsg.includes("demand") || 
                        lowerMsg.includes("quota") || 
                        lowerMsg.includes("429") || 
                        lowerMsg.includes("exhausted") ||
                        lowerMsg.includes("overloaded");

  if (isHighDemand) {
    return t.aiErrorQuota || "The AI system is at peak capacity. We are automatically switching to extra-stable fallback resources to keep your conversation going. Please try sending your message again.";
  }
  
  if (lowerMsg.includes("api key") || lowerMsg.includes("configured") || lowerMsg.includes("auth")) {
    return t.aiErrorConfig || "AI service configuration issue. Please check your system settings.";
  }
  
  return errorMsg || t.aiErrorGeneral;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'weather' | 'diagnosis' | 'market' | 'community' | 'settings'>('chat');
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('language') as Language) || 'en');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'light');
  const t = TRANSLATIONS[language] || TRANSLATIONS.en;
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(true);
  const [isChatSending, setIsChatSending] = useState(false);
  const [appLogo, setAppLogo] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  // Lifted states for caching/quota management
  const [weatherData, setWeatherData] = useState<any>(null);
  const [locationName, setLocationName] = useState<string>('');
  const [weatherCache, setWeatherCache] = useState<Record<string, any>>({});
  const [marketPrices, setMarketPrices] = useState<any[]>(SAMPLE_MARKET_PRICES);
  const [marketTranslations, setMarketTranslations] = useState<Record<string, any[]>>({});
  const [lastMarketUpdate, setLastMarketUpdate] = useState<string>(new Date().toLocaleTimeString());
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showGlobalPrices, setShowGlobalPrices] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);

  useEffect(() => {
    const detectLocation = async () => {
      if (!locationName) {
        setIsDetectingLocation(true);
        
        const tryIPFallbacks = async () => {
          const services = [
            'https://freeipapi.com/api/json',
            'https://ipapi.co/json/',
            'https://ipwho.is/'
          ];

          for (const service of services) {
            try {
              const res = await fetch(service, { signal: AbortSignal.timeout(5000) });
              if (!res.ok) continue;
              const data = await res.json();
              
              let city = "";
              if (service.includes('freeipapi.com')) {
                city = data.cityName;
              } else if (service.includes('ipapi.co')) {
                city = data.city;
              } else if (service.includes('ipwho.is')) {
                if (data.success) city = data.city;
              }

              if (city) {
                setLocationName(city);
                console.log(`[Location] Detected via ${service}:`, city);
                return true;
              }
            } catch (e) {
              console.warn(`[Location] service ${service} unsuccessful`, e);
            }
          }
          return false;
        };

        // Prefer GPS for accuracy
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              const { latitude, longitude } = position.coords;
              try {
                const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=${language}`);
                if (!res.ok) throw new Error("Reverse geocode failed");
                const data = await res.json();
                const city = data.city || data.locality || data.principalSubdivision || "Kigali";
                setLocationName(city);
                toast.success(`${t.usingGPS}: ${city}`, { icon: <MapPin size={16}/> });
              } catch (e) {
                console.warn("[Location] Reverse geocode failed, trying IP fallback", e);
                const success = await tryIPFallbacks();
                if (!success) {
                  setLocationName("Kigali");
                  console.log("[Location] Defaulting to Kigali (Geocode failure)");
                }
              } finally {
                setIsDetectingLocation(false);
              }
            },
            async (error) => {
              console.log("[Location] Geolocation permission denied or unavailable, using IP fallback");
              const success = await tryIPFallbacks();
              if (!success) {
                console.log("[Location] All detection methods exhausted, defaulting to Kigali");
                setLocationName("Kigali");
              }
              setIsDetectingLocation(false);
            },
            { timeout: 8000, enableHighAccuracy: false }
          );
        } else {
          const success = await tryIPFallbacks();
          if (!success) setLocationName("Kigali");
          setIsDetectingLocation(false);
        }
      }
    };
    detectLocation();
  }, [t.usingGPS, language]);

  // Online/Offline detection logic
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      toast.success("Back online! Syncing data...");
    };
    const handleOffline = () => {
      setIsOffline(true);
      toast.error("You are offline. Some features may be limited.");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const targetTitle = "UMUHINZI AI";
    try {
      document.title = targetTitle;
    } catch (e) {
      // document.title might be read-only due to the lock in index.html
    }
    
    // Also update meta description if possible
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', "Inclusive agricultural AI assistant for farmers, featuring chatbot, weather alerts, crop diagnosis, market prices, and community interaction.");
    }
  }, []);

  const isAdmin = user?.email === "mr7035152@gmail.com";

  // --- Auth & Profile ---
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, '_system_', 'connectivity'));
      } catch (error) {
        // Quietly ignore if denied or offline, the console already has detailed logs from firebase.ts
      }
    };
    testConnection();

    // Fetch App Logo
    const unsubLogo = onSnapshot(doc(db, 'settings', 'app'), (doc) => {
      if (doc.exists()) {
        setAppLogo(doc.data().logoUrl);
      }
    }, (error) => {
      if (error.code !== 'unavailable' && error.code !== 'permission-denied') {
        handleFirestoreError(error, OperationType.GET, 'settings/app');
      } else {
        console.warn("Settings listener deferred:", error.code);
      }
    });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          // Try to get from server first to ensure we have fresh data
          let userDoc;
          try {
            userDoc = await getDocFromServer(doc(db, 'users', firebaseUser.uid));
          } catch (e) {
            console.warn("Could not reach server for profile fetch, falling back to cache", e);
            userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          }

          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            setProfile(data);
            if (data.language) {
              setLanguage(data.language);
              localStorage.setItem('language', data.language);
            }
            if (data.theme) {
              setTheme(data.theme);
              localStorage.setItem('theme', data.theme);
            }
          } else {
            const newProfile: any = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Farmer',
              photoURL: firebaseUser.photoURL || '',
              language: language,
              theme: theme,
              notificationsEnabled: true,
              createdAt: new Date().toISOString()
            };
            if (firebaseUser.email) newProfile.email = firebaseUser.email;
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            setProfile(newProfile as UserProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setProfile(null);
      }
      setIsAuthReady(true);
    });
    return () => {
      unsubscribe();
      unsubLogo();
    };
  }, []);

  // --- Theme Application ---
  useEffect(() => {
    const root = window.document.documentElement;
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => {
      const newTheme = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      if (user) {
        updateDoc(doc(db, 'users', user.uid), { theme: newTheme }).catch(err => 
          handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`)
        );
      }
      return newTheme;
    });
  };

  const changeLanguage = async (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('language', lang);
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { language: lang });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    }
  };

  const toggleNotifications = async () => {
    if (!user || !profile) return;
    const newValue = !profile.notificationsEnabled;
    
    if (newValue && "Notification" in window) {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.info(t.notifDisabled);
        }
      } catch (e) {
        console.warn("Notification permission request failed", e);
      }
    }

    try {
      await updateDoc(doc(db, 'users', user.uid), { notificationsEnabled: newValue });
      setProfile({ ...profile, notificationsEnabled: newValue });
      toast.success(newValue ? t.notificationsEnabled : t.notificationsDisabled);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  // --- Notifications Logic ---
  const sendNotification = (title: string, body: string) => {
    if (!profile?.notificationsEnabled) return;

    // 1. Show in-app toast
    toast(title, {
      description: body,
      icon: <Bell className="text-green-600" size={18} />,
    });

    // 2. Try browser notification
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body });
      } catch (e) {
        console.warn("Browser notification failed", e);
      }
    }
  };

  // Weather Notification Logic
  useEffect(() => {
    if (weatherData && profile?.notificationsEnabled) {
      const condition = weatherData.condition?.toLowerCase() || "";
      const isRaining = condition.includes('rain') || condition.includes('shower') || condition.includes('drizzle');
      const lastCheck = localStorage.getItem('last_rain_check');
      const today = new Date().toDateString();

      if (isRaining && lastCheck !== today + '_rain') {
        sendNotification(t.rainAlert, t.rainExpected);
        localStorage.setItem('last_rain_check', today + '_rain');
      } else if (!isRaining && lastCheck !== today + '_no_rain') {
        sendNotification(t.noRainAlert, t.noRainExpected);
        localStorage.setItem('last_rain_check', today + '_no_rain');
      }
    }
  }, [weatherData, profile?.notificationsEnabled, language]);

  // Market & Seasonal AI Advice Notification Logic
  useEffect(() => {
    if (!profile?.notificationsEnabled || !weatherData || !isAuthReady) return;

    const generateSeasonalInsight = async () => {
      const lastCheck = localStorage.getItem('last_seasonal_check');
      const today = new Date().toDateString();
      if (lastCheck === today) return;

      try {
        const response = await callEngine((ai, model) => ai.models.generateContent({
          model,
          contents: `You are the ${APP_NAME} Seasonal Advisor. 
          Today is ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. 
          Current Seasonal Phase in Rwanda: ${new Date().getMonth() >= 2 && new Date().getMonth() <= 5 ? 'Season B (Long Rains)' : new Date().getMonth() >= 9 && new Date().getMonth() <= 12 ? 'Season A (Short Rains)' : 'Dry Season'}.
          Location Context: ${locationName || 'Rwanda'}. 
          Weather Context: ${weatherData.temp}°C, ${weatherData.condition}.
          
          Generate a unique, highly specific agricultural alert for TODAY in ${language}. 
          IMPORTANT: Do not repeat generic advice. Provide data-driven insights about market price spikes, specific pest outbreaks related to the current humidity, or precise planting windows for less common crops (e.g., passion fruit, macadamia).
          
          Possible themes:
          1. Market price alert (e.g., "Maize prices in Kimironko market spiked by 5% today")
          2. Planting/harvesting tip (e.g., "The moisture index is optimal for planting climbing beans in Musanze today")
          3. Pest/Disease localized warning (e.g., "Current humidity levels in the East favor armyworm migration")
          
          Return strictly as JSON: { "title": string, "body": string }
          Maintain professional tone but be concise.`
        }), 5, 3000, setIsAiBusy);

        const insight = parseEngineResponse(response);
        if (insight.title && insight.body) {
          sendNotification(insight.title, insight.body);
          localStorage.setItem('last_seasonal_check', today);
        }
      } catch (error) {
        console.warn("Could not generate seasonal insight notification", error);
      }
    };

    generateSeasonalInsight();
  }, [weatherData, profile?.notificationsEnabled, language, isAuthReady]);

  // Group Invitation Notification Logic
  useEffect(() => {
    if (!user || !profile?.notificationsEnabled) return;

    const q = query(
      collection(db, 'notifications'), 
      where('recipientUid', '==', user.uid),
      where('type', '==', 'group_invite'),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          sendNotification(t.groupInvitation, t.groupInviteMsg.replace('{groupName}', data.groupName || 'Unknown Group'));
        }
      });
    }, (error) => {
      // If unavailable, just log it quietly - don't crash
      if (error.code === 'unavailable') {
        console.warn("Notifications listener deferred: Firestore unavailable (offline).");
      } else {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      }
    });

    return () => unsubscribe();
  }, [user, profile?.notificationsEnabled, language]);

  // New Post Notification Logic
  useEffect(() => {
    if (!user || !profile?.notificationsEnabled) return;

    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const post = snapshot.docs[0].data();
        const lastPostId = localStorage.getItem('last_post_notif');
        
        if (post.authorUid !== user.uid && snapshot.docs[0].id !== lastPostId) {
          sendNotification("New Community Post", `${post.authorName} shared a new update!`);
          localStorage.setItem('last_post_notif', snapshot.docs[0].id);
        }
      }
    }, (error) => {
      if (error.code !== 'unavailable' && error.code !== 'permission-denied') {
        handleFirestoreError(error, OperationType.LIST, 'posts_notif_stream');
      }
    });

    return () => unsubscribe();
  }, [user, profile?.notificationsEnabled]);

  // Room Invitation Notification Logic
  useEffect(() => {
    if (!user || !profile?.notificationsEnabled) return;

    const q = query(collection(db, 'rooms'), where('members', 'array-contains', user.uid), orderBy('createdAt', 'desc'), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const room = snapshot.docs[0].data();
        const lastRoomId = localStorage.getItem('last_room_notif');
        
        if (room.creator !== user.uid && snapshot.docs[0].id !== lastRoomId) {
          sendNotification(t.groupInvitation, t.groupInviteMsg.replace("{groupName}", room.name));
          localStorage.setItem('last_room_notif', snapshot.docs[0].id);
        }
      }
    }, (error) => {
      if (error.code !== 'unavailable' && error.code !== 'permission-denied') {
        handleFirestoreError(error, OperationType.LIST, 'rooms_notif_stream');
      }
    });

    return () => unsubscribe();
  }, [user, profile?.notificationsEnabled, language]);

  // Rain Notification Logic
  useEffect(() => {
    if (!weatherData || !profile?.notificationsEnabled) return;
    
    const condition = weatherData.condition?.toLowerCase() || "";
    const isRainy = condition.includes("rain") || condition.includes("shower") || condition.includes("storm") || condition.includes("imvura") || condition.includes("pluie") || condition.includes("mvua");
    
    if (isRainy) {
      sendNotification(t.rainAlert, t.rainExpected);
    } else {
      sendNotification(t.noRainAlert, t.noRainExpected);
    }
  }, [weatherData, profile?.notificationsEnabled, language]);

  useEffect(() => {
    if (!profile?.notificationsEnabled || !isAuthReady) return;

    const triggerNotifications = () => {
      const now = new Date();
      const month = now.getMonth();

      // Translated crop names
      const cropsMap: Record<string, Record<string, string>> = {
        en: { maize: "Maize", beans: "Beans", potatoes: "Potatoes", coffee: "Coffee", tea: "Tea", wheat: "Wheat", sorghum: "Sorghum", vegetables: "Vegetables", onions: "Onions", cassava: "Cassava", bananas: "Bananas", rice: "Rice", cotton: "Cotton", sugarcane: "Sugarcane" },
        rw: { maize: "Ibigori", beans: "Ibishyimbo", potatoes: "Ibirayi", coffee: "Ikawa", tea: "Icyayi", wheat: "Ingano", sorghum: "Amasaka", vegetables: "Imboga", onions: "Ibitunguru", cassava: "Imyumbati", bananas: "Ibitoki", rice: "Umuceri", cotton: "Ipamba", sugarcane: "Ibihuha" },
        fr: { maize: "Maïs", beans: "Haricots", potatoes: "Pommes de terre", coffee: "Café", tea: "Thé", wheat: "Blé", sorghum: "Sorgho", vegetables: "Légumes", onions: "Oignons", cassava: "Manioc", bananas: "Bananes", rice: "Riz", cotton: "Coton", sugarcane: "Canne à sucre" },
        sw: { maize: "Mahindi", beans: "Maharagwe", potatoes: "Viazi", coffee: "Kahawa", tea: "Chai", wheat: "Ngano", sorghum: "Mtama", vegetables: "Mboga", onions: "Vitunguu", cassava: "Muhogo", bananas: "Ndizi", rice: "Wali", cotton: "Pamba", sugarcane: "Miwa" },
        es: { maize: "Maíz", beans: "Frijoles", potatoes: "Papas", coffee: "Café", tea: "Té", wheat: "Trigo", sorghum: "Sorgo", vegetables: "Verduras", onions: "Cebollas", cassava: "Yuca", bananas: "Plátanos", rice: "Arroz", cotton: "Algodón", sugarcane: "Caña de azúcar" },
        pt: { maize: "Milho", beans: "Feijão", potatoes: "Batatas", coffee: "Café", tea: "Chá", wheat: "Trigo", sorghum: "Sorgo", vegetables: "Vegetais", onions: "Cebolas", cassava: "Mandioca", bananas: "Bananas", rice: "Arroz", cotton: "Algodão", sugarcane: "Cana-de-açúcar" },
        zh: { maize: "玉米", beans: "豆类", potatoes: "土豆", coffee: "咖啡", tea: "茶叶", wheat: "小麦", sorghum: "高粱", vegetables: "蔬菜", onions: "洋葱", cassava: "木薯", bananas: "香蕉", rice: "大米", cotton: "棉花", sugarcane: "甘蔗" },
        ar: { maize: "ذرة", beans: "فاصوليا", potatoes: "بطاطس", coffee: "قهوة", tea: "شاي", wheat: "قمح", sorghum: "ذرة بيضاء", vegetables: "خضروات", onions: "بصل", cassava: "كسافا", bananas: "موز", rice: "أرز", cotton: "قطن", sugarcane: "قصب السكر" },
        hi: { maize: "मक्का", beans: "बीन्स", potatoes: "आलू", coffee: "कॉफी", tea: "चाय", wheat: "गेहूं", sorghum: "ज्वार", vegetables: "सब्जियां", onions: "प्याज", cassava: "कसावा", bananas: "केले", rice: "चावल", cotton: "कपास", sugarcane: "गन्ना" },
      };

      const c = cropsMap[language] || cropsMap['en'];

      const translateCrops = (cropsStr: string) => {
        return cropsStr.split(', ').map(crop => {
          const key = crop.toLowerCase().split(' ')[0]; // Handle "Coffee (Global)" -> "coffee"
          return c[key] || crop;
        }).join(', ');
      };

      let cultivate = "";
      let harvest = "";
      
      if (month >= 2 && month <= 4) {
        cultivate = `${c.maize}, ${c.beans}, ${c.potatoes}`;
        harvest = `${c.coffee}, ${c.tea}`;
      } else if (month >= 8 && month <= 10) {
        cultivate = `${c.wheat}, ${c.sorghum}`;
        harvest = `${c.maize}, ${c.beans}`;
      } else {
        cultivate = `${c.vegetables}, ${c.onions}`;
        harvest = `${c.cassava}, ${c.bananas}`;
      }

      if (t.notifCultivate) {
        sendNotification(t.weatherAlert, t.notifCultivate.replace("{crops}", cultivate));
      }
      
      setTimeout(() => {
        if (t.notifHarvest) {
          sendNotification(t.weatherAlert, t.notifHarvest.replace("{crops}", harvest));
        }
      }, 5000);

      const upCrops = translateCrops(SAMPLE_MARKET_PRICES.filter(c => c.trend === 'up').slice(0, 2).map(c => c.name).join(", "));
      const downCrops = translateCrops(SAMPLE_MARKET_PRICES.filter(c => c.trend === 'down').slice(0, 2).map(c => c.name).join(", "));

      setTimeout(() => {
        if (upCrops && t.notifPriceUp) {
          sendNotification(t.marketPrices, t.notifPriceUp.replace("{crops}", upCrops));
        }
      }, 10000);

      setTimeout(() => {
        if (downCrops && t.notifPriceDown) {
          sendNotification(t.marketPrices, t.notifPriceDown.replace("{crops}", downCrops));
        }
      }, 15000);
    };

    const timer = setTimeout(triggerNotifications, 3000);
    const interval = setInterval(triggerNotifications, 10 * 60 * 1000); // Every 10 mins

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [profile?.notificationsEnabled, language, isAuthReady]);

  if (!isAuthReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-stone-50 dark:bg-zinc-950">
        <motion.div 
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-green-600 font-bold text-2xl"
        >
          {APP_NAME}
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-zinc-950 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-white dark:bg-zinc-900 p-8 rounded-[2.5rem] shadow-2xl shadow-green-600/10 border border-zinc-100 dark:border-zinc-800 text-center space-y-8"
        >
          <div className="w-20 h-20 bg-green-600 rounded-3xl mx-auto flex items-center justify-center text-white shadow-xl shadow-green-600/20">
            <Sprout size={40} />
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black tracking-tighter text-zinc-900 dark:text-white">{APP_NAME}</h2>
            <p className="text-zinc-500 text-sm font-medium">{t.chatbotDescription}</p>
          </div>
          <button 
            onClick={() => signInWithPopup(auth, googleProvider)}
            className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-green-700 transition-all shadow-lg shadow-green-600/20 group"
          >
            <LogIn size={20} className="group-hover:translate-x-1 transition-transform" />
            {t.login}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-stone-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
        <Toaster position="top-center" theme={theme} />
        
        {/* Offline Indicator */}
        <AnimatePresence>
          {isOffline && (
            <motion.div 
              initial={{ y: -50 }}
              animate={{ y: 0 }}
              exit={{ y: -50 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] bg-red-500 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2"
            >
              <WifiOff size={14} />
              Offline Mode - Viewing cached data
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hamburger Menu Overlay */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMenuOpen(false)}
                className="fixed inset-0 z-[1000] bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed inset-y-0 left-0 z-[1010] bg-white dark:bg-zinc-900 w-80 shadow-2xl overflow-y-auto"
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center text-white">
                        <Sprout size={24} />
                      </div>
                      <h2 className="text-xl font-bold text-slate-900 dark:text-white">{APP_NAME}</h2>
                    </div>
                    <button 
                      onClick={() => setIsMenuOpen(false)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                    >
                      <X size={24} className="text-slate-500" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {[
                      { id: 'chat', icon: MessageSquare, label: t.chatbot },
                      { id: 'weather', icon: CloudRain, label: t.weather },
                      { id: 'diagnosis', icon: Camera, label: t.diagnosis },
                      { id: 'market', icon: ShoppingBag, label: t.market },
                      { id: 'community', icon: Users, label: t.community },
                      { id: 'settings', icon: Settings, label: t.settings },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id as any);
                          setIsMenuOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-4 p-4 rounded-xl transition-all",
                          activeTab === item.id 
                            ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' 
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        )}
                      >
                        <item.icon size={22} />
                        <span className="font-medium">{item.label}</span>
                      </button>
                    ))}
                  </div>

                  {user && (
                    <div className="mt-auto pt-8 border-t border-slate-100 dark:border-slate-800 space-y-4">
                      <div className="flex items-center gap-3 p-2">
                        <img 
                          src={user.photoURL || ''} 
                          alt={user.displayName || ''} 
                          className="w-12 h-12 rounded-full border-2 border-green-500/20" 
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex flex-col min-w-0">
                          <p className="font-bold text-slate-900 dark:text-white truncate">{user.displayName}</p>
                          <p className="text-xs text-slate-500 truncate">{user.email}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          signOut(auth);
                          setIsMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-4 p-4 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all font-bold"
                      >
                        <LogOut size={22} />
                        <span>{t.logout}</span>
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Global Prices Modal */}
        <AnimatePresence>
          {showGlobalPrices && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
              >
                <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Globe className="text-blue-500" />
                      {t.globalPrices}
                    </h3>
                    <button 
                      onClick={() => {
                        setShowGlobalPrices(false);
                        setGlobalSearch('');
                      }}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                    >
                      <X size={20} className="text-slate-500" />
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input 
                      type="text"
                      value={globalSearch}
                      onChange={(e) => setGlobalSearch(e.target.value)}
                      placeholder={t.searchCrop}
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 pl-10 pr-4 py-2.5 rounded-xl outline-none focus:ring-2 ring-blue-500/20 transition-all text-sm text-left"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div className="p-6 overflow-y-auto">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(marketTranslations[language] || marketPrices)
                      .filter((p, idx) => marketPrices[idx].category === 'Global')
                      .filter(p => 
                        p.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
                        p.category.toLowerCase().includes(globalSearch.toLowerCase())
                      )
                      .map((price) => (
                      <div key={price.id} className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-bold text-slate-900 dark:text-white">{price.name}</span>
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase",
                            price.trend === 'up' ? 'bg-red-100 text-red-600' : 
                            price.trend === 'down' ? 'bg-green-100 text-green-600' : 
                            'bg-zinc-100 text-zinc-600'
                          )}>
                            {price.trend === 'up' ? '↑' : price.trend === 'down' ? '↓' : '→'}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-lg font-bold text-green-600">${price.price}</span>
                          <span className="text-[10px] text-zinc-500 font-bold uppercase">/ {price.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-green-600/20 overflow-hidden">
              {appLogo ? (
                <img src={appLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <Sprout size={24} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <h1 className="font-black text-lg leading-none tracking-tighter text-green-700 dark:text-green-500">{APP_NAME}</h1>
              <span className="text-[10px] font-black text-green-600/50 uppercase tracking-widest hidden xs:block">UMUHINZI AI</span>
            </div>
          </div>

          <button 
            onClick={() => setIsMenuOpen(true)}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            <Menu size={24} className="text-zinc-600 dark:text-zinc-400" />
          </button>
        </header>

        {/* Main Content */}
        <main className="pt-20 pb-24 max-w-2xl mx-auto px-4">
          <AnimatePresence mode="wait">
            {activeTab === 'chat' && (
              <ChatView 
                key={`chat-${user?.uid || 'guest'}`}
                language={language} 
                theme={theme} 
                setTheme={setTheme} 
                user={user}
                messages={chatMessages}
                setMessages={setChatMessages}
                showHistory={showChatHistory}
                setShowHistory={setShowChatHistory}
                isSending={isChatSending}
                setIsSending={setIsChatSending}
                isAiBusy={isAiBusy}
                setIsAiBusy={setIsAiBusy}
              />
            )}
            {activeTab === 'weather' && (
              <WeatherView 
                key="weather" 
                language={language} 
                weatherData={weatherData}
                setWeatherData={setWeatherData}
                locationName={locationName}
                setLocationName={setLocationName}
                weatherCache={weatherCache}
                setWeatherCache={setWeatherCache}
                isAiBusy={isAiBusy}
                setIsAiBusy={setIsAiBusy}
              />
            )}
            {activeTab === 'diagnosis' && (
              <DiagnosisView 
                key="diagnosis" 
                language={language} 
                isAiBusy={isAiBusy}
                setIsAiBusy={setIsAiBusy}
              />
            )}
            {activeTab === 'market' && (
              <MarketView 
                key="market" 
                language={language} 
                marketPrices={marketPrices}
                setMarketPrices={setMarketPrices}
                marketTranslations={marketTranslations}
                setMarketTranslations={setMarketTranslations}
                lastUpdate={lastMarketUpdate}
                setLastUpdate={setLastMarketUpdate}
                isAiBusy={isAiBusy}
                setIsAiBusy={setIsAiBusy}
                setShowGlobalPrices={setShowGlobalPrices}
              />
            )}
            {activeTab === 'community' && (
              <CommunityView 
                key="community" 
                language={language} 
                user={user} 
                isAiBusy={isAiBusy}
                setIsAiBusy={setIsAiBusy}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsView 
                key="settings" 
                language={language} 
                setLanguage={changeLanguage} 
                user={user} 
                theme={theme} 
                toggleTheme={toggleTheme}
                profile={profile}
                toggleNotifications={toggleNotifications}
                isAdmin={isAdmin}
                appLogo={appLogo}
              />
            )}
          </AnimatePresence>
        </main>
      </div>
    </ErrorBoundary>
  );
}

// --- View Components ---

function ChatView({ 
  language, 
  theme, 
  setTheme, 
  user,
  messages,
  setMessages,
  showHistory,
  setShowHistory,
  isSending,
  setIsSending,
  isAiBusy,
  setIsAiBusy
}: { 
  language: Language, 
  theme: Theme, 
  setTheme: (t: Theme) => void, 
  user: User | null,
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  showHistory: boolean,
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>,
  isSending: boolean,
  setIsSending: React.Dispatch<React.SetStateAction<boolean>>,
  isAiBusy: boolean,
  setIsAiBusy: (b: boolean) => void
}) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.title !== APP_NAME) {
        try {
          document.title = APP_NAME;
        } catch (e) {}
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const t = TRANSLATIONS[language];

  const isSendingRef = useRef(isSending);
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  // --- Real-time Sessions Listener ---
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'users', user.uid, 'sessions'),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sess = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ChatSession));
      setSessions(sess);
    }, (error) => {
      if (error.code !== 'unavailable') {
        handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions`);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // --- Real-time Messages Listener for Current Session ---
  useEffect(() => {
    if (!user || !currentSessionId) {
      if (!currentSessionId) setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'sessions', currentSessionId, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(200)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => {
        const data = doc.data();
        let timestamp = data.timestamp;
        if (timestamp && typeof timestamp === 'object' && 'seconds' in timestamp) {
          timestamp = timestamp.seconds * 1000;
        }
        
        return {
          id: doc.id,
          ...data,
          timestamp: timestamp || Date.now()
        } as ChatMessage;
      });
      
      setMessages(msgs);
    }, (error) => {
      if (error.code !== 'unavailable') {
        handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/sessions/${currentSessionId}/messages`);
      }
    });

    return () => unsubscribe();
  }, [user, currentSessionId, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage, isTyping]);

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;
    
    const tempId = user ? doc(collection(db, 'users', user.uid, 'sessions', currentSessionId || 'temp', 'messages')).id : `temp-${Date.now()}`;
    const userMsg: ChatMessage = { 
      id: tempId,
      role: 'user', 
      content: text, 
      timestamp: Date.now() 
    };
    
    setIsSending(true);
    // Add locally for instant feedback
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    let sessionId = currentSessionId;

    if (user) {
      try {
        if (!sessionId) {
          // Create new session
          const sessionRef = await addDoc(collection(db, 'users', user.uid, 'sessions'), {
            userId: user.uid,
            title: text.slice(0, 40) + (text.length > 40 ? '...' : ''),
            lastMessage: text,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          sessionId = sessionRef.id;
          setCurrentSessionId(sessionId);
        } else {
          // Update existing session
          await updateDoc(doc(db, 'users', user.uid, 'sessions', sessionId), {
            lastMessage: text,
            updatedAt: new Date().toISOString()
          });
        }

        // Use setDoc with the pre-generated ID to avoid duplication when onSnapshot fires
        await setDoc(doc(db, 'users', user.uid, 'sessions', sessionId, 'messages', tempId), userMsg);
      } catch (error) {
        console.error("Firestore save error:", error);
      }
    }

    const generateImageTool = {
      name: "generateImage",
      description: "Generate a realistic agricultural or general image based on a prompt.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          prompt: {
            type: Type.STRING,
            description: "The description of the image to generate. Be specific about subject, environment, and style (realistic, 4k)."
          }
        },
        required: ["prompt"]
      }
    };

    try {
      let result;
      let aiCallAttempts = 0;
      const maxAiCallAttempts = 3;

      while (aiCallAttempts < maxAiCallAttempts) {
        try {
          result = await callEngine(async (ai, modelName) => {
            return await ai.models.generateContentStream({
              model: modelName,
              contents: messages.concat(userMsg).slice(-12).map(m => ({
                role: m.role,
                parts: [{ text: m.content.slice(0, 4000) }]
              })),
              config: {
                systemInstruction: `STRICT IDENTITY: You are ${APP_NAME}, a world-master AI assistant.
                CURRENT DATE & TIME: ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })}.
                MISSION: Provide 100% VALID, RELIABLE, and UPDATED advice on ANY topic (Agriculture, Sports, News, etc.).
                CORE DIRECTIVE: You MUST use Google Search Grounding to provide real-time facts, current events, and live sports scores (like CAVB matches). Never say "I don't have access to real-time data" because you DO have access via the search tool.
                CREDITS: Created by ${CREATOR_CREDITS}.
                Reply in ${LANGUAGE_NAMES[language] || 'English'}.`,
                tools: [
                  { googleSearch: {} }
                ],
                toolConfig: { includeServerSideToolInvocations: true },
                temperature: 0.7,
              }
            });
          }, 5, 2000, setIsAiBusy);
          
          if (result) break;
        } catch (err) {
          aiCallAttempts++;
          console.warn(`[Chat] AI Call attempt ${aiCallAttempts} failed. Retrying...`);
          if (aiCallAttempts === maxAiCallAttempts) {
            await resetAiEngine();
            throw err;
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      if (!result) {
        await resetAiEngine();
        throw new Error("The AI service is temporarily unstable after multiple attempts. We have reset the secure connection layer. Please try sending your message again.");
      }

      let fullText = '';
      let imageUrl = '';
      let firstChunkReceived = false;
      let hasError = false;

      try {
        for await (const chunk of result) {
          const chunkText = chunk.text || '';
          if (chunkText) {
            firstChunkReceived = true;
            setIsTyping(false);
            fullText += chunkText;
            
            // Theme switching logic
            if (fullText.includes('[SET_THEME:dark]')) {
              setTheme('dark');
              fullText = fullText.replace('[SET_THEME:dark]', '');
            } else if (fullText.includes('[SET_THEME:light]')) {
              setTheme('light');
              fullText = fullText.replace('[SET_THEME:light]', '');
            }

            setStreamingMessage({ 
              role: 'model', 
              content: fullText, 
              imageUrl: imageUrl || undefined,
              timestamp: Date.now() 
            });
          }
          
          if (chunk.functionCalls) {
            const call = chunk.functionCalls.find((c: any) => c.name === 'generateImage');
            if (call && call.args?.prompt) {
              const generated = await generateEngineImage(call.args.prompt as string, setIsAiBusy);
              if (generated) imageUrl = generated;
            }
          }
        }
      } catch (streamErr) {
        console.warn("Stream interrupted:", streamErr);
        hasError = true;
      }

      if (!firstChunkReceived && !imageUrl) {
        throw new Error("The AI counselor is momentarily preoccupied with other farmers. Please try sending your message again.");
      }
      
      if (fullText || imageUrl) {
        const aiMsgId = user && sessionId ? doc(collection(db, 'users', user.uid, 'sessions', sessionId, 'messages')).id : `ai-${Date.now()}`;
        const finalAiMsg: ChatMessage = {
          id: aiMsgId,
          role: 'model',
          content: fullText || (language === 'rw' ? 'Icyitonderwa: Ikosa ryabaye mu gusubiza...' : 'Note: Response interrupted...'),
          timestamp: Date.now()
        };
        if (imageUrl) finalAiMsg.imageUrl = imageUrl;

        if (user && sessionId) {
          try {
            setStreamingMessage(null);
            await setDoc(doc(db, 'users', user.uid, 'sessions', sessionId, 'messages', aiMsgId), finalAiMsg);
            await updateDoc(doc(db, 'users', user.uid, 'sessions', sessionId), {
              lastMessage: fullText.slice(0, 100),
              updatedAt: new Date().toISOString()
            });
          } catch (error) {
            console.error("Firestore AI save error:", error);
          }
        } else {
          setMessages(prev => [...prev, finalAiMsg]);
          setStreamingMessage(null);
        }

        if (isSpeaking && fullText) speak(fullText);
      }
    } catch (error: any) {
      console.error("Chat error:", error);
      const userMsg = getErrorUserMessage(error, language);
      toast.error(userMsg === error?.message ? `AI System Error: ${userMsg}` : userMsg);
      setIsTyping(false);
      setStreamingMessage(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setIsSidebarOpen(false);
    toast.info(t.newChatStarted);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sId: string) => {
    e.stopPropagation();
    setSessionToDelete(sId);
  };

  const confirmDeleteSession = async () => {
    if (!user || !sessionToDelete) return;
    const sId = sessionToDelete;
    try {
      const batch = writeBatch(db);
      const msgs = await getDocs(collection(db, 'users', user.uid, 'sessions', sId, 'messages'));
      msgs.forEach(m => batch.delete(m.ref));
      batch.delete(doc(db, 'users', user.uid, 'sessions', sId));
      await batch.commit();
      if (currentSessionId === sId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      toast.success(t.chatDeleted);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${sId}`);
      toast.error(t.failedToDelete);
    } finally {
      setSessionToDelete(null);
    }
  };

  const handleDeleteMessage = async (msgId?: string) => {
    if (!user || !msgId || !currentSessionId) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'sessions', currentSessionId, 'messages', msgId));
      toast.success(t.msgDeleted);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/sessions/${currentSessionId}/messages/${msgId}`);
      toast.error(t.failedToDelete);
    }
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language === 'rw' ? 'rw-RW' : language === 'fr' ? 'fr-FR' : language === 'sw' ? 'sw-KE' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error !== 'no-speech') {
        toast.error("Voice input failed. Please try again.");
      }
    };
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      handleSend(transcript);
    };
    recognition.start();
  };

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) {
      toast.error("Voice output not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel(); // Stop any current speech

    // Clean markdown for better reading
    const cleanText = text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#/g, '')
      .replace(/`/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // [link](url) -> link
      .replace(/(\n)+/g, ' ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Improved voice selection
    const voices = window.speechSynthesis.getVoices();
    const langMap: Record<string, string> = {
      rw: 'sw-KE', // Kinyarwanda doesn't have good native TTS usually, Swahili is a close phonemic match
      fr: 'fr-FR',
      sw: 'sw-KE',
      it: 'it-IT',
      de: 'de-DE',
      ru: 'ru-RU',
      es: 'es-ES',
      pt: 'pt-BR',
      zh: 'zh-CN',
      ar: 'ar-SA',
      hi: 'hi-IN',
      en: 'en-US'
    };

    const targetLang = langMap[language] || 'en-US';
    utterance.lang = targetLang === 'sw-KE' && language === 'rw' ? 'rw-RW' : targetLang;
    
    // Explicitly try rw-RW then fallback to sw-KE for Kinyarwanda
    const findBestVoice = () => {
      if (language === 'rw') {
        const rwVoice = voices.find(v => v.lang.startsWith('rw') || v.lang.includes('Kinyarwanda'));
        if (rwVoice) return rwVoice;
      }
      return voices.find(v => v.lang.startsWith(targetLang) && v.localService) || 
             voices.find(v => v.lang.startsWith(targetLang));
    };

    const bestVoice = findBestVoice();
    if (bestVoice) {
      utterance.voice = bestVoice;
      if (language === 'rw' && !bestVoice.lang.startsWith('rw')) {
        utterance.lang = 'sw-KE'; // Ensure Swahili lang tag if using Swahili voice for Kinyarwanda
      }
    }

    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return t.today;
    if (date.toDateString() === yesterday.toDateString()) return t.yesterday;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const uniqueMessages = useMemo(() => {
    const seenIds = new Set<string>();
    const seenContent = new Set<string>();
    return messages.filter(m => {
      if (m.id && seenIds.has(m.id)) return false;
      if (m.id) seenIds.add(m.id);
      
      const contentKey = `${m.role}-${m.content.slice(0, 100)}`;
      if (seenContent.has(contentKey)) return false;
      seenContent.add(contentKey);
      
      return true;
    });
  }, [messages]);

  const groupedMessages = useMemo(() => {
    return uniqueMessages.reduce((groups: { [key: string]: ChatMessage[] }, message) => {
      const date = formatDate(message.timestamp);
      if (!groups[date]) groups[date] = [];
      groups[date].push(message);
      return groups;
    }, {});
  }, [uniqueMessages]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex h-[calc(100dvh-11rem)] sm:h-[calc(100vh-12rem)] relative overflow-hidden"
    >
      {/* Sidebar for Chat History */}
      {/* Delete Session Confirmation Modal */}
      <AnimatePresence>
        {sessionToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-zinc-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-200 dark:border-zinc-800"
            >
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center text-red-600 mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-bold mb-2">{t.deleteChat}?</h3>
              <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">
                {t.deleteConfirmDesc}
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setSessionToDelete(null)}
                  className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-2xl transition-colors"
                >
                  {t.cancel}
                </button>
                <button 
                  onClick={confirmDeleteSession}
                  className="flex-1 py-3 text-sm font-bold bg-red-600 text-white rounded-2xl hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                >
                  {t.delete}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-50 flex flex-col shadow-2xl"
          >
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-sm uppercase tracking-widest text-zinc-500">{t.history}</h3>
              <button onClick={() => setIsSidebarOpen(false)} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                <Minus size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              <button 
                onClick={handleNewChat}
                className="w-full flex items-center gap-2 p-3 text-sm font-medium text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-xl transition-colors mb-2 border border-dashed border-green-200 dark:border-green-900/40"
              >
                <Plus size={16} />
                {t.newChat}
              </button>
              {sessions.map(s => (
                <div 
                  key={s.id}
                  onClick={() => {
                    setCurrentSessionId(s.id);
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "group relative flex items-center gap-2 p-3 text-sm rounded-xl cursor-pointer transition-all",
                    currentSessionId === s.id 
                      ? "bg-green-600 text-white shadow-lg shadow-green-600/20" 
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                  )}
                >
                  <MessageSquare size={14} className="shrink-0" />
                  <span className="truncate flex-1 pr-6">{s.title}</span>
                  <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-all">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        const newTitle = prompt("Rename chat:", s.title);
                        if (newTitle && newTitle.trim() && user) {
                          updateDoc(doc(db, 'users', user.uid, 'sessions', s.id), { title: newTitle.trim() });
                        }
                      }}
                      className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                    >
                      <Eraser size={12} />
                    </button>
                    <button 
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      className="p-1 hover:bg-red-500 hover:text-white rounded"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Chat Header */}
        <div className="flex items-center justify-between mb-4 px-1 shrink-0">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors text-zinc-500"
            >
              <History size={20} />
            </button>
            <div className="flex flex-col">
              <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate max-w-[150px]">
                {currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : t.newChat}
              </h2>
            </div>
          </div>
          
          <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 p-1 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <button 
              onClick={handleNewChat}
              className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
              title="New Chat"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar pb-24">
        {Object.entries(groupedMessages).map(([date, msgs]) => (
          <div key={date} className="space-y-4">
            <div className="flex justify-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-1 rounded-full border border-zinc-100 dark:border-zinc-800">
                {date}
              </span>
            </div>
            {msgs.map((msg, i) => (
              <div key={msg.id || i} className={cn(
                "flex group relative",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}>
                <div className={cn(
                  "max-w-[85%] px-4 py-3 rounded-2xl text-sm shadow-sm relative",
                  msg.role === 'user' 
                    ? "bg-green-600 text-white rounded-tr-none" 
                    : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-tl-none text-zinc-800 dark:text-zinc-200"
                )}>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <Markdown>{msg.content || '...'}</Markdown>
                  </div>
                  
                  {msg.imageUrl && (
                    <div className="mt-3 rounded-xl overflow-hidden border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
                      <img 
                        src={msg.imageUrl} 
                        alt="AI Generated" 
                        className="w-full h-auto max-h-[400px] object-cover" 
                        referrerPolicy="no-referrer" 
                      />
                    </div>
                  )}
                  
                  <div className={cn(
                    "text-[8px] mt-1 opacity-50 font-bold uppercase tracking-tighter",
                    msg.role === 'user' ? "text-right" : "text-left"
                  )}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  
                  {/* Individual Delete Button */}
                  {user && msg.id && (
                    <button 
                      onClick={() => handleDeleteMessage(msg.id)}
                      className={cn(
                        "absolute -top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full text-zinc-400 hover:text-red-500 shadow-md z-10",
                        msg.role === 'user' ? "-left-2" : "-right-2"
                      )}
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        {(streamingMessage || isTyping) && (
          <div key="streaming" className="flex justify-start">
            <div className="max-w-[85%] px-4 py-3 rounded-2xl text-sm shadow-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-tl-none text-zinc-800 dark:text-zinc-200">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="relative">
                  {streamingMessage ? (
                    <>
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-100 dark:border-zinc-700">
                        <div className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                        </div>
                        <span className="text-[10px] font-bold text-green-600 uppercase tracking-widest">
                          AI Response
                        </span>
                      </div>
                      <Markdown>{streamingMessage.content}</Markdown>
                      {streamingMessage.imageUrl && (
                        <div className="mt-3 rounded-xl overflow-hidden border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
                          <img 
                            src={streamingMessage.imageUrl} 
                            alt="AI Generated" 
                            className="w-full h-auto max-h-[400px] object-cover" 
                            referrerPolicy="no-referrer" 
                          />
                        </div>
                      )}
                      <motion.span
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="inline-block w-1 h-4 bg-green-500 ml-1 align-middle"
                      />
                    </>
                  ) : (
                    <div className="flex gap-1.5 items-center py-2 px-1">
                      <motion.div 
                        animate={{ 
                          y: [0, -5, 0], 
                          scale: [1, 1.2, 1],
                          backgroundColor: ['#22c55e', '#4ade80', '#22c55e'] 
                        }} 
                        transition={{ repeat: Infinity, duration: 0.8, delay: 0 }} 
                        className="w-1.5 h-1.5 rounded-full shadow-sm shadow-green-500/20" 
                      />
                      <motion.div 
                        animate={{ 
                          y: [0, -5, 0], 
                          scale: [1, 1.2, 1],
                          backgroundColor: ['#22c55e', '#4ade80', '#22c55e'] 
                        }} 
                        transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} 
                        className="w-1.5 h-1.5 rounded-full shadow-sm shadow-green-500/20" 
                      />
                      <motion.div 
                        animate={{ 
                          y: [0, -5, 0], 
                          scale: [1, 1.2, 1],
                          backgroundColor: ['#22c55e', '#4ade80', '#22c55e'] 
                        }} 
                        transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} 
                        className="w-1.5 h-1.5 rounded-full shadow-sm shadow-green-500/20" 
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-2xl pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] px-4 z-40 border-t border-zinc-200/50 dark:border-zinc-800/50 shadow-lg">
        <div className="flex gap-2 items-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[2.5rem] p-1.5 shadow-xl transition-all max-w-3xl mx-auto relative group">
          <button 
            type="button"
            onClick={startListening}
            className={cn(
              "w-11 h-11 rounded-full transition-all active:scale-90 flex items-center justify-center flex-shrink-0",
              isListening ? "bg-red-500 text-white animate-pulse" : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            )}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isSending && handleSend()}
            placeholder={t.askAnything}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-base sm:text-lg px-2 py-3 placeholder:text-zinc-400 text-left"
            dir="auto"
          />
          <div className="flex items-center gap-1.5 pr-1 flex-shrink-0">
            <button 
              type="button"
              onClick={() => {
                if (isSpeaking) {
                  window.speechSynthesis.cancel();
                  setIsSpeaking(false);
                  return;
                }
                const lastAiMessage = [...messages].reverse().find(m => m.role === 'model');
                if (lastAiMessage) {
                  speak(lastAiMessage.content);
                } else {
                  toast.info("No AI response to read yet.");
                }
              }}
              className={cn(
                "w-11 h-11 rounded-full transition-colors flex items-center justify-center",
                isSpeaking ? "text-green-600 bg-green-50 dark:bg-green-900/20" : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
              title={isSpeaking ? "Stop Reading" : "Read Last Response"}
            >
              {isSpeaking ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button 
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim() || isSending || isAiBusy}
              title="Send Message"
              aria-label="Send Message"
              className={cn(
                "flex items-center justify-center w-12 h-12 bg-green-600 text-white rounded-full transition-all active:scale-95 shadow-lg shadow-green-600/30 flex-shrink-0 relative overflow-hidden",
                (isSending || !input.trim() || isAiBusy) ? "opacity-50 cursor-not-allowed" : "hover:bg-green-500 hover:scale-105"
              )}
            >
              {(isSending || isAiBusy) ? (
                <RefreshCw size={20} className="animate-spin" />
              ) : (
                <Send size={20} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  </motion.div>
  );
}

function WeatherView({ 
  language, 
  weatherData, 
  setWeatherData, 
  locationName, 
  setLocationName,
  weatherCache,
  setWeatherCache,
  isAiBusy,
  setIsAiBusy
}: { 
  language: Language, 
  weatherData: any, 
  setWeatherData: (d: any) => void,
  locationName: string,
  setLocationName: (s: string) => void,
  weatherCache: Record<string, any>,
  setWeatherCache: (c: Record<string, any>) => void,
  isAiBusy: boolean,
  setIsAiBusy: (b: boolean) => void
}) {
  const [advice, setAdvice] = useState<string>(weatherData?.advice || '');
  const [loading, setLoading] = useState(!weatherData);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const t = TRANSLATIONS[language];

  const fetchWeatherByCoords = async (latitude: number, longitude: number, customName?: string) => {
    const cacheKey = `${latitude.toFixed(2)}_${longitude.toFixed(2)}_${language}`;
    if (weatherCache[cacheKey]) {
      const cached = weatherCache[cacheKey];
      const isExpired = Date.now() - cached.timestamp > 3600000; // 1 hour
      if (!isExpired) {
        setWeatherData(cached.data);
        setLocationName(cached.location);
        setAdvice(cached.data.advice);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    try {
      let realLocation = customName || "";
      if (!customName) {
        try {
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1&t=${Date.now()}`, {
            headers: { 
              'Accept-Language': language,
              'User-Agent': 'Umuhinzi-AI-App'
            }
          });
          const geoData = await geoRes.json();
          const addr = geoData.address;
          
          const road = addr.road || addr.pedestrian || "";
          const village = addr.village || addr.suburb || addr.neighbourhood || addr.hamlet || addr.quarter || "";
          const district = addr.city_district || addr.county || addr.district || "";
          const city = addr.city || addr.town || addr.municipality || "";
          const region = addr.state || addr.province || addr.region || "";
          
          const parts = Array.from(new Set([road, village, district, city, region].filter(Boolean)));
          realLocation = parts.join(', ');
          
          if (!realLocation && geoData.display_name) {
            realLocation = geoData.display_name.split(',').slice(0, 4).join(', ');
          }
        } catch (e) {
          console.warn("Reverse geocoding failed", e);
        }
      }

      const response = await callEngine((ai, model) => ai.models.generateContent({
        model,
        contents: `CRITICAL INSTRUCTION: You are a world-class agricultural meteorologist as of April 23, 2026. 
        Your mission is to simulate 100% ACCURATE and scientifically VALID weather data for ${realLocation || 'this precise location'} (latitude: ${latitude}, longitude: ${longitude}).
        
        Provide:
        1. Current temperature in Celsius (number).
        2. Weather condition (string, e.g., "Sunny", "Heavy Rain", "Cloudy").
        3. Detailed, expert agricultural advice (string) specifically for farmers in this exact geographic area at ${realLocation}. Include advice on irrigation, pest control, and soil management based on the 2026 climate patterns.
        4. Specific crops ready for harvest right now in this specific location (string[]).
        5. Specific crops to plant or cultivate right now based on local seasonal patterns (string[]).
        6. The name of the location based on coordinates (string).
        
        Return STRICTLY as JSON: { "temp": number, "condition": string, "advice": string, "harvestCrops": string[], "cultivateCrops": string[], "locationName": string }.
        Respond in ${LANGUAGE_NAMES[language] || 'English'}. Ensure the advice is scientifically sound, practical, and 100% RELEVANT to the local context.`,
      }), 5, 3000, setIsAiBusy);
      
      const data = parseEngineResponse(response);
      setWeatherData(data);
      setAdvice(data.advice);
      const finalLocation = realLocation || data.locationName || "Detected Location";
      setLocationName(finalLocation);
      
      // Update cache
      const cacheKey = `${latitude.toFixed(2)}_${longitude.toFixed(2)}_${language}`;
      setWeatherCache(prev => ({
        ...prev,
        [cacheKey]: { data, location: finalLocation, timestamp: Date.now() }
      }));
    } catch (error: any) {
      console.error("Weather fetch failed:", error);
      toast.error(getErrorUserMessage(error, language));
    } finally {
      setLoading(false);
    }
  };

  const fetchWeather = async () => {
    setLoading(true);
    
    const fetchFromIP = async () => {
      try {
        const res = await fetch('https://ipwho.is/');
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            await fetchWeatherByCoords(data.latitude, data.longitude, data.city);
            return true;
          }
        }
      } catch (e) {
        console.warn("IP location fallback failed", e);
      }
      return false;
    };

    if (!navigator.geolocation) {
      const ipSuccess = await fetchFromIP();
      if (!ipSuccess) {
        toast.error("Location services unavailable.");
        setLoading(false);
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
      async (err) => {
        console.warn("Geolocation failed, trying IP fallback...", err);
        if (err.code === 1) {
          toast.info("Please allow location access in your browser settings for highly accurate advice.");
        }
        const ipSuccess = await fetchFromIP();
        if (!ipSuccess) {
          toast.error("Could not detect location. Please search manually.");
          setLoading(false);
        }
      },
      { 
        enableHighAccuracy: true, 
        timeout: 10000, 
        maximumAge: 0 
      }
    );
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      // Primary search
      let res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&addressdetails=1`, {
        headers: { 'User-Agent': 'Umuhinzi-AI-App' }
      });
      let data = await res.json();
      
      // Fallback: broaden search if no results
      if (!data || data.length === 0) {
        res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery + ' region city')}&limit=1`, {
          headers: { 'User-Agent': 'Umuhinzi-AI-App' }
        });
        data = await res.json();
      }

      if (data && data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const shortName = display_name.split(',').slice(0, 3).join(', ');
        await fetchWeatherByCoords(parseFloat(lat), parseFloat(lon), shortName);
        setSearchQuery('');
      } else {
        toast.error(t.locationNotFound);
      }
    } catch (error) {
      toast.error(t.searchFailed);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (!weatherData) {
      fetchWeather();
    }
  }, [language, weatherData]);

  if (loading) return (
    <div className="p-12 flex flex-col items-center justify-center space-y-4">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
        <Globe className="absolute inset-0 m-auto text-blue-600 animate-pulse" size={24} />
      </div>
      <div className="text-center">
        <p className="font-bold text-zinc-800 dark:text-zinc-200">{t.detectingLocation}</p>
        <p className="text-xs text-zinc-500 mt-1">{t.usingGPS}</p>
      </div>
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6"
    >
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-8 rounded-[2rem] shadow-2xl shadow-blue-500/30 relative overflow-hidden">
        <div className="relative z-10">
          <form onSubmit={handleSearch} className="mb-6 flex gap-2">
            <div className="flex-1 relative">
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchLocationPlaceholder}
                className="w-full bg-white/10 border border-white/20 rounded-xl py-2 px-4 text-sm placeholder:text-white/50 outline-none focus:bg-white/20 transition-all"
              />
              <Search size={16} className="absolute right-3 top-2.5 opacity-50" />
            </div>
            <button 
              type="submit"
              disabled={isSearching || isAiBusy}
              className="bg-white text-blue-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              {isSearching || isAiBusy ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                t.search
              )}
            </button>
          </form>

          <div className="flex justify-between items-start mb-6">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100/80">Location</p>
              </div>
              <h2 className="text-xl font-bold leading-tight max-w-[250px]">
                {locationName || t.location}
              </h2>
            </div>
            <button 
              onClick={fetchWeather}
              disabled={loading || isAiBusy}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors disabled:opacity-50"
              title="Use GPS"
            >
              <RefreshCw size={16} className={(loading || isAiBusy) ? "animate-spin" : ""} />
            </button>
          </div>
          
          <div className="flex items-end gap-4 mb-2">
            <h3 className="text-7xl font-black tracking-tighter">{weatherData?.temp}°C</h3>
            <div className="pb-2">
              <p className="text-xl font-bold text-blue-100">{weatherData?.condition}</p>
              <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">{t.weatherAlert}</p>
            </div>
          </div>
        </div>
        <CloudSun size={180} className="absolute -right-8 -bottom-8 opacity-10 rotate-12" />
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl space-y-6">
        <div className="space-y-2">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Sun className="text-orange-500" />
            {t.agriAdvice}
          </h3>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {advice}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              {t.cropsToHarvest}
            </h4>
            <div className="flex flex-wrap gap-2">
              {weatherData?.harvestCrops?.map((crop: string, i: number) => (
                <span key={i} className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-green-100 dark:border-green-800/50">
                  {crop}
                </span>
              ))}
              {(!weatherData?.harvestCrops || weatherData.harvestCrops.length === 0) && (
                <p className="text-xs text-zinc-500 italic">{t.noHarvest}</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              {t.cropsToCultivate}
            </h4>
            <div className="flex flex-wrap gap-2">
              {weatherData?.cultivateCrops?.map((crop: string, i: number) => (
                <span key={i} className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-blue-100 dark:border-blue-800/50">
                  {crop}
                </span>
              ))}
              {(!weatherData?.cultivateCrops || weatherData.cultivateCrops.length === 0) && (
                <p className="text-xs text-zinc-500 italic">{t.noCultivate}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function DiagnosisView({ 
  language,
  isAiBusy,
  setIsAiBusy
}: { 
  language: Language,
  isAiBusy: boolean,
  setIsAiBusy: (b: boolean) => void
}) {
  const [image, setImage] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = TRANSLATIONS[language];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        try {
          const compressed = await compressImage(base64, 1024, 0.7);
          setImage(compressed);
          analyzeImage(compressed);
        } catch (error) {
          console.error("Compression failed:", error);
          setImage(base64);
          analyzeImage(base64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async (base64: string) => {
    setLoading(true);
    try {
      const response = await callEngine((ai, model) => ai.models.generateContent({
        model,
        contents: [
          { text: `Analyze this crop image. Identify disease, cause, and prevention. Use search grounding if the symptoms are complex.
            Return JSON: { "disease": string, "cause": string, "prevention": string }.
            Respond in ${LANGUAGE_NAMES[language] || 'English'}.` },
          { inlineData: { data: base64.split(',')[1], mimeType: "image/jpeg" } }
        ],
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true }
        }
      }), 5, 3000, setIsAiBusy);
      const data = parseEngineResponse(response);
      setDiagnosis(data);
    } catch (error: any) {
      console.error("Diagnosis failed:", error);
      toast.error(getErrorUserMessage(error, language));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div 
        onClick={() => !isAiBusy && !loading && fileInputRef.current?.click()}
        className={cn(
          "aspect-square sm:aspect-video bg-white dark:bg-zinc-900 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl flex flex-col items-center justify-center transition-colors overflow-hidden group",
          (isAiBusy || loading) ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-green-500"
        )}
      >
        {image ? (
          <img src={image} alt="Crop" className="w-full h-full object-cover" />
        ) : (
          <>
            <Camera size={48} className="text-zinc-300 group-hover:text-green-500 transition-colors mb-4" />
            <p className="text-sm font-bold text-zinc-400">{t.uploadPhoto}</p>
          </>
        )}
        <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
      </div>

      {loading && <div className="text-center p-4 animate-pulse font-bold text-green-600">{t.scanningCrop}</div>}

      {diagnosis && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl space-y-4"
        >
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{t.disease}</h4>
            <p className="text-lg font-bold text-red-600">{diagnosis.disease}</p>
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{t.cause}</h4>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{diagnosis.cause}</p>
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1">{t.prevention}</h4>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{diagnosis.prevention}</p>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function MarketView({ 
  language, 
  marketPrices, 
  setMarketPrices, 
  marketTranslations, 
  setMarketTranslations,
  lastUpdate,
  setLastUpdate,
  isAiBusy,
  setIsAiBusy,
  setShowGlobalPrices
}: { 
  language: Language, 
  marketPrices: any[], 
  setMarketPrices: (d: any[]) => void,
  marketTranslations: Record<string, any[]>,
  setMarketTranslations: (d: Record<string, any[]>) => void,
  lastUpdate: string,
  setLastUpdate: (s: string) => void,
  isAiBusy: boolean,
  setIsAiBusy: (b: boolean) => void,
  setShowGlobalPrices: (b: boolean) => void
}) {
  const [search, setSearch] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [currentLocation, setCurrentLocation] = useState<string | null>(null);
  const [currentCurrency, setCurrentCurrency] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadedPrices, setHasLoadedPrices] = useState(false);
  const t = TRANSLATIONS[language];

  // Auto-refresh/translate on language change if data is already loaded
  useEffect(() => {
    if (hasLoadedPrices && currentLocation) {
      handleRefresh(currentLocation);
    }
  }, [language]);

  const handleRefresh = async (manualLocation?: string) => {
    const loc = manualLocation || currentLocation || 'Rwanda';
    setIsRefreshing(true);
    setHasLoadedPrices(true);
    
    // Split crops into batches to ensure AI stability and full translation
    const batchSize = 50;
    const allCrops = [...marketPrices];
    const batches = [];
    for (let i = 0; i < allCrops.length; i += batchSize) {
      batches.push(allCrops.slice(i, i + batchSize));
    }

    let updatedPricesList: any[] = [];
    let detectedCurrency = currentCurrency;
    let translatedLoc = currentLocation || loc;

    try {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const cropsToProcess = batch.map(c => ({ 
          id: c.id, 
          originalName: c.name 
        }));

        const response = await callEngine((ai, model) => ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [{ text: `CRITICAL MISSION: Global agricultural commodity analyst. Data set ${i + 1}/${batches.length}.
              DATE: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
              GOAL: Provide 100% VALID, REAL-WORLD crop market rates for ${loc}.
              STRICT: Do not provide fake data. If a specific local price is unknown, provide the most accurate regional estimate for ${loc} as of TODAY.
              
              1. Local currency for ${loc}.
              2. CURRENT prices for these crops (if they are 'Global' items like Coffee/Cocoa, use international index): ${JSON.stringify(cropsToProcess)}
              3. STRICT TRANSLATION: Translate EVERY crop name, unit, and category into ${LANGUAGE_NAMES[language] || 'English'} (${language}).
              
              Return ONLY a JSON object:
              {
                "translatedLocation": "Formal Name in ${LANGUAGE_NAMES[language]}",
                "currency": "ISO Code",
                "prices": [
                  { 
                    "id": "match_input_id", 
                    "name": "translated_name_in_${language}", 
                    "price": "numeric", 
                    "unit": "translated_unit_in_${language}", 
                    "trend": "up"|"stable"|"down",
                    "category": "translated_category_in_${language}"
                  }
                ]
              }`}]
            }
          ],
          config: {
            responseMimeType: "application/json"
          }
        }), 12, 2000, setIsAiBusy);

        const data = parseEngineResponse(response);
        if (data && data.prices) {
          detectedCurrency = data.currency || detectedCurrency;
          translatedLoc = data.translatedLocation || translatedLoc;
          
          batch.forEach(oldCrop => {
            const found = data.prices.find((r: any) => r.id === oldCrop.id);
            if (found) {
              updatedPricesList.push({
                ...oldCrop,
                name: found.name || oldCrop.name,
                price: found.price || oldCrop.price,
                unit: found.unit || oldCrop.unit,
                trend: found.trend || oldCrop.trend,
                category: found.category || oldCrop.category
              });
            } else {
              updatedPricesList.push(oldCrop);
            }
          });
        } else {
          updatedPricesList.push(...batch);
        }
      }

      if (updatedPricesList.length > 0) {
        setMarketPrices(updatedPricesList);
        setCurrentLocation(translatedLoc);
        setCurrentCurrency(detectedCurrency);
        setLastUpdate(new Date().toLocaleTimeString());
        toast.success(t.pricesUpdated);
        setMarketTranslations({});
      }
    } catch (error: any) {
      console.error("Market refresh failed:", error);
      toast.error(getErrorUserMessage(error, language));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLocationSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationQuery.trim()) return;
    handleRefresh(locationQuery);
    setLocationQuery('');
  };

  const day = new Date().getDate();
  const getFluctuatedPrices = useMemo(() => {
    const source = marketTranslations[language] || marketPrices;
    return source.map((crop, idx) => {
      const originalCrop = marketPrices.find(p => p.id === crop.id) || crop;
      const basePrice = parseFloat(String(originalCrop.price).replace(/,/g, ''));
      if (isNaN(basePrice)) return crop;
      
      // Small daily fluctuation for visual interest
      const shiftPercent = (((day + idx) % 7) - 3) / 100; // -3% to +3%
      const newPrice = basePrice * (1 + shiftPercent);
      
      const trends: Array<'up' | 'down' | 'stable'> = ['up', 'down', 'stable'];
      const newTrend = trends[(day + idx) % 3];

      return {
        ...crop,
        price: newPrice.toLocaleString(undefined, { 
          minimumFractionDigits: basePrice < 10 ? 2 : 0, 
          maximumFractionDigits: 4 
        }),
        trend: newTrend
      };
    });
  }, [language, marketPrices, marketTranslations, day]);

  const filteredCrops = getFluctuatedPrices.filter((crop) => 
    crop.category !== 'Global' &&
    (crop.name.toLowerCase().includes(search.toLowerCase()) ||
     crop.category.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {!hasLoadedPrices ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-8 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px]">
          <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-600">
            <Globe2 size={40} className="animate-pulse" />
          </div>
          <div className="max-w-md mx-auto">
            <h2 className="text-2xl font-black text-zinc-900 dark:text-white mb-2 leading-tight">
              {t.welcomeMarket}
            </h2>
            <p className="text-zinc-500 font-medium">
              {t.selectCountryDesc}
            </p>
          </div>

          <div className="w-full space-y-4">
            <form onSubmit={handleLocationSearch} className="relative group">
              <Globe2 className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-green-500 transition-colors" size={20} />
              <input 
                type="text" 
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                placeholder={t.searchPlaceholderMarket}
                className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 pl-12 pr-4 py-5 rounded-2xl outline-none focus:ring-2 ring-green-500/20 transition-all font-bold text-lg"
              />
            </form>

            <div className="space-y-3">
              <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center justify-center gap-2">
                <MapPin size={12} /> {t.quickSelect}
              </h4>
              <div className="flex flex-wrap justify-center gap-2">
                {COUNTRIES.slice(0, 10).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCurrentLocation(c.name);
                      handleRefresh(c.name);
                    }}
                    className="px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center gap-2 hover:border-green-500 transition-all font-bold text-sm shadow-sm"
                  >
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
              
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {COUNTRIES.slice(10).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCurrentLocation(c.name);
                      handleRefresh(c.name);
                    }}
                    className="flex-shrink-0 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center gap-2 hover:border-green-500 transition-all font-bold text-xs whitespace-nowrap shadow-sm"
                  >
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest leading-none mb-1">
                  {t.marketPrices} — {currentLocation}
                </h3>
                <p className="text-[10px] text-zinc-500 font-medium">{t.lastUpdated}: {lastUpdate}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHasLoadedPrices(false)}
                  className="p-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 rounded-xl hover:bg-zinc-200 transition-colors flex items-center gap-2"
                  title={t.switchRegion}
                >
                  <MapPin size={18} />
                  <span className="text-xs font-bold hidden sm:inline">{t.switchRegion}</span>
                </button>
                <button
                  onClick={() => setShowGlobalPrices(true)}
                  className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors flex items-center gap-2"
                >
                  <Globe size={18} />
                  <span className="text-xs font-bold hidden sm:inline">{t.globalPrices}</span>
                </button>
                <button 
                  onClick={() => handleRefresh()}
                  disabled={isRefreshing || isAiBusy}
                  className="p-2 bg-green-50 dark:bg-green-900/20 text-green-600 rounded-xl hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={18} className={(isRefreshing || isAiBusy) ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <form onSubmit={handleLocationSearch} className="relative group">
                <Globe2 className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-green-500 transition-colors" size={20} />
                <input 
                  type="text" 
                  value={locationQuery}
                  onChange={(e) => setLocationQuery(e.target.value)}
                  placeholder={t.changeLocation}
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 pl-12 pr-4 py-4 rounded-2xl outline-none focus:ring-2 ring-green-500/20 transition-all text-left font-bold"
                  dir="ltr"
                />
              </form>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                <input 
                  type="text" 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchCrop}
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 pl-12 pr-4 py-4 rounded-2xl outline-none focus:ring-2 ring-green-500/20 transition-all text-left"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Global Country Selector (Horizontal Strip when loaded) */}
            <div>
              <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
                {COUNTRIES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCurrentLocation(c.name);
                      handleRefresh(c.name);
                    }}
                    className={cn(
                      "flex-shrink-0 px-4 py-3 rounded-xl border flex items-center gap-2 transition-all font-bold text-xs whitespace-nowrap",
                      currentLocation === c.name 
                        ? "bg-green-600 border-green-600 text-white shadow-lg shadow-green-500/30" 
                        : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-green-500 shadow-sm"
                    )}
                  >
                    <span>{c.flag}</span>
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-zinc-400" />
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">
                  {t.pricesIn} <span className="text-zinc-600 dark:text-zinc-300">{currentLocation}</span> • {t.currencyLabel}: <span className="text-green-600 font-black">{currentCurrency}</span>
                </p>
              </div>
              <button 
                onClick={() => setHasLoadedPrices(false)}
                className="text-[10px] font-black text-green-600 uppercase tracking-widest hover:underline"
              >
                {t.switchRegion}
              </button>
            </div>
          </div>

          {isRefreshing ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <RefreshCw size={40} className="text-green-500 animate-spin" />
              <p className="text-zinc-500 font-bold animate-pulse">
                {t.fetchingPrices}
              </p>
            </div>
          ) : filteredCrops.length === 0 ? (
            <div className="py-20 text-center space-y-4">
              <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 mx-auto">
                <Search size={32} />
              </div>
              <p className="text-zinc-500 font-bold">{t.noFilteredCrops}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-8">
              {filteredCrops.map((crop, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl flex items-center justify-between hover:shadow-md transition-shadow group shadow-sm border-b-4 border-b-zinc-100 dark:border-b-zinc-800 hover:border-b-green-500"
                >
                  <div>
                    <h4 className="font-bold group-hover:text-green-600 transition-colors">{crop.name}</h4>
                    <p className="text-xs text-zinc-500">{crop.category}</p>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-center gap-1">
                      <p className="text-lg font-black text-green-600 tracking-tight">{crop.price} {currentCurrency}</p>
                      {crop.trend === 'up' && <TrendingUp size={14} className="text-red-500" />}
                      {crop.trend === 'down' && <TrendingDown size={14} className="text-green-500" />}
                      {crop.trend === 'stable' && <Minus size={14} className="text-zinc-400" />}
                    </div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase">{t.per} {crop.unit}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function CommunityView({ 
  language, 
  user,
  isAiBusy,
  setIsAiBusy
}: { 
  language: Language, 
  user: User | null,
  isAiBusy: boolean,
  setIsAiBusy: (b: boolean) => void
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [commentingOn, setCommentingOn] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<Record<string, any[]>>({});
  const [translatedTexts, setTranslatedTexts] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<'feed' | 'rooms'>('feed');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomMessages, setRoomMessages] = useState<any[]>([]);
  const [newRoomMessage, setNewRoomMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [rooms, setRooms] = useState<any[]>([]);
  const [publicRooms, setPublicRooms] = useState<any[]>([]);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [isRoomPublic, setIsRoomPublic] = useState(false);
  const [customJoinCode, setCustomJoinCode] = useState('');
  const [showJoinRoom, setShowJoinRoom] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [roomTab, setRoomTab] = useState<'my' | 'discover'>('my');
  const t = TRANSLATIONS[language];

  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPosts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));
    }, (error) => {
      if (error.code !== 'unavailable') {
        handleFirestoreError(error, OperationType.LIST, 'posts');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'rooms'), where('members', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      if (error.code !== 'unavailable') {
        handleFirestoreError(error, OperationType.LIST, 'rooms');
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (view !== 'rooms' || roomTab !== 'discover') return;
    const q = query(
      collection(db, 'rooms'), 
      where('isPublic', '==', true),
      limit(20)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPublicRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      if (error.code !== 'unavailable') {
        console.warn("Public room fetch failed (possibly no index yet):", error);
      }
    });
    return () => unsubscribe();
  }, [view, roomTab]);

  useEffect(() => {
    if (!user || !activeRoomId) {
      setRoomMessages([]);
      return;
    }
    const q = query(collection(db, 'rooms', activeRoomId, 'messages'), orderBy('createdAt', 'asc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRoomMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      if (error.code !== 'unavailable') {
        handleFirestoreError(error, OperationType.LIST, `rooms/${activeRoomId}/messages`);
      }
    });
    return () => unsubscribe();
  }, [user, activeRoomId]);

  const handleSendRoomMessage = async () => {
    if (!user || !activeRoomId || !newRoomMessage.trim() || isSending) return;
    try {
      setIsSending(true);
      await addDoc(collection(db, 'rooms', activeRoomId, 'messages'), {
        authorUid: user.uid,
        authorName: user.displayName,
        authorPhoto: user.photoURL,
        content: newRoomMessage,
        createdAt: new Date().toISOString()
      });
      setNewRoomMessage('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `rooms/${activeRoomId}/messages`);
      toast.error("Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteRoomMessage = async (messageId: string) => {
    if (!user || !activeRoomId) {
      console.warn("Delete failed: No user or active room", { user: !!user, activeRoomId });
      return;
    }
    
    console.log("Attempting to delete message:", messageId, "in room:", activeRoomId);
    const loadingToast = toast.loading("Deleting message...");
    
    try {
      await deleteDoc(doc(db, 'rooms', activeRoomId, 'messages', messageId));
      toast.dismiss(loadingToast);
      toast.success("Message deleted");
      console.log("Successfully deleted message:", messageId);
    } catch (error) {
      toast.dismiss(loadingToast);
      console.error("Delete message error:", error);
      handleFirestoreError(error, OperationType.DELETE, `rooms/${activeRoomId}/messages/${messageId}`);
      toast.error("Failed to delete message. Check console for details.");
    }
  };

  const handleCreateRoom = async () => {
    if (!user || !newRoomName.trim()) return;
    try {
      const joinCode = customJoinCode.trim().toUpperCase() || Math.random().toString(36).substring(2, 8).toUpperCase();
      await addDoc(collection(db, 'rooms'), {
        name: newRoomName,
        creator: user.uid,
        members: [user.uid],
        admins: [user.uid],
        pendingApprovals: 0,
        joinCode: joinCode,
        createdAt: new Date().toISOString(),
        isPrivate: !isRoomPublic,
        isPublic: isRoomPublic
      });
      setNewRoomName('');
      setCustomJoinCode('');
      setIsRoomPublic(false);
      setShowCreateRoom(false);
      toast.success((isRoomPublic ? t.public : t.privateRoom) + " created! Code: " + joinCode);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'rooms');
      toast.error(t.failedToCreateRoom);
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'rooms', roomId));
      toast.success(t.roomDeleted);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `rooms/${roomId}`);
      toast.error(t.failedToDeleteRoom);
    }
  };

  const handleJoinRoom = async (roomId: string, code: string) => {
    if (!user) return;
    try {
      const roomDoc = await getDoc(doc(db, 'rooms', roomId));
      if (!roomDoc.exists()) return;
      const roomData = roomDoc.data();
      
      if (roomData.joinCode !== code.toUpperCase()) {
        toast.error(t.invalidCode);
        return;
      }

      await updateDoc(doc(db, 'rooms', roomId), {
        pendingApprovals: increment(1), // Just a trigger for admin
        pendingUids: Array.from(new Set([...(roomData.pendingUids || []), user.uid]))
      });
      toast.info(t.waitingForAdmin);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    }
  };

  const handleApproveMember = async (roomId: string, memberUid: string) => {
    if (!user) return;
    try {
      const roomDoc = await getDoc(doc(db, 'rooms', roomId));
      if (!roomDoc.exists()) return;
      const roomData = roomDoc.data();
      
      await updateDoc(doc(db, 'rooms', roomId), {
        members: Array.from(new Set([...roomData.members, memberUid])),
        pendingUids: roomData.pendingUids.filter((id: string) => id !== memberUid)
      });
      toast.success(t.memberApproved);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    }
  };

  const fetchComments = (postId: string) => {
    if (comments[postId]) return;
    const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
    onSnapshot(q, (snapshot) => {
      setComments(prev => ({
        ...prev,
        [postId]: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      }));
    }, (error) => {
      if (error.code !== 'unavailable') {
        handleFirestoreError(error, OperationType.LIST, `posts/${postId}/comments`);
      }
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error(t.imageTooLarge);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      try {
        setIsUploading(true);
        const compressed = await compressImage(base64, 800, 0.7);
        setSelectedImage(compressed);
      } catch (error) {
        console.error("Compression error:", error);
        toast.error("Failed to process image");
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePost = async () => {
    if (!user || (!newPost.trim() && !selectedImage) || isSending) return;
    try {
      setIsSending(true);
      await addDoc(collection(db, 'posts'), {
        authorUid: user.uid,
        authorName: user.displayName,
        authorPhoto: user.photoURL,
        content: newPost,
        imageUrl: selectedImage || null,
        likes: 0,
        createdAt: new Date().toISOString()
      });
      setNewPost('');
      setSelectedImage(null);
      toast.success(t.postShared);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'posts');
      toast.error(t.failedToPost);
    } finally {
      setIsSending(false);
    }
  };

  const handleComment = async (postId: string) => {
    if (!user || !newComment.trim() || isSending) return;
    try {
      setIsSending(true);
      await addDoc(collection(db, 'posts', postId, 'comments'), {
        postId,
        authorUid: user.uid,
        authorName: user.displayName,
        authorPhoto: user.photoURL,
        content: newComment,
        createdAt: new Date().toISOString()
      });
      setNewComment('');
      setCommentingOn(null);
      toast.success(t.commentAdded);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `posts/${postId}/comments`);
      toast.error(t.failedToComment);
    } finally {
      setIsSending(false);
    }
  };

  const handleLike = async (postId: string) => {
    if (!user) return;
    const likeRef = doc(db, 'posts', postId, 'likes', user.uid);
    const postRef = doc(db, 'posts', postId);
    
    try {
      const likeDoc = await getDoc(likeRef);
      const batch = writeBatch(db);
      
      if (likeDoc.exists()) {
        // Unlike
        batch.delete(likeRef);
        batch.update(postRef, {
          likes: increment(-1)
        });
        await batch.commit();
      } else {
        // Like
        batch.set(likeRef, { uid: user.uid, createdAt: new Date().toISOString() });
        batch.update(postRef, {
          likes: increment(1)
        });
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `posts/${postId}/likes/${user.uid}`);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'posts', postId));
      toast.success(t.postDeleted);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${postId}`);
      toast.error(t.failedToDelete);
    }
  };

  const handleDeleteComment = async (postId: string, commentId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'posts', postId, 'comments', commentId));
      toast.success("Comment deleted");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${postId}/comments/${commentId}`);
      toast.error("Failed to delete comment");
    }
  };

  const handleTranslate = async (id: string, text: string) => {
    if (translatedTexts[id]) {
      setTranslatedTexts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    setIsTranslating(prev => ({ ...prev, [id]: true }));
    try {
      const result = await callEngine((ai, model) => ai.models.generateContent({
        model,
        contents: `Translate the following text into ${language}. Return ONLY the translated text.
        Text: "${text}"`
      }), 5, 3000, setIsAiBusy);
      const translated = parseEngineResponse(result);
      setTranslatedTexts(prev => ({ ...prev, [id]: translated }));
    } catch (error) {
      console.error("Translation error:", error);
      toast.error(getErrorUserMessage(error, language));
    } finally {
      setIsTranslating(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleTranslateRoom = async (roomId: string, text: string) => {
    await handleTranslate(roomId, text);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          <button 
            onClick={() => setView('feed')}
            className={cn(
              "text-sm font-bold uppercase tracking-widest pb-1 border-b-2 transition-all",
              view === 'feed' ? "text-green-600 border-green-600" : "text-zinc-400 border-transparent"
            )}
          >
            {t.community}
          </button>
          <button 
            onClick={() => setView('rooms')}
            className={cn(
              "text-sm font-bold uppercase tracking-widest pb-1 border-b-2 transition-all",
              view === 'rooms' ? "text-green-600 border-green-600" : "text-zinc-400 border-transparent"
            )}
          >
            {t.privateRooms}
          </button>
        </div>
        {view === 'rooms' && (
          <div className="flex gap-2">
            <button 
              onClick={() => setShowJoinRoom(true)}
              className="p-2 bg-blue-600 text-white rounded-full shadow-lg shadow-blue-600/20 hover:scale-110 transition-transform"
              title={t.join}
            >
              <LogIn size={20} />
            </button>
            <button 
              onClick={() => setShowCreateRoom(true)}
              className="p-2 bg-green-600 text-white rounded-full shadow-lg shadow-green-600/20 hover:scale-110 transition-transform"
              title={t.create}
            >
              <Plus size={20} />
            </button>
          </div>
        )}
      </div>

      {showCreateRoom && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-3"
        >
          <input 
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder={t.roomName + "..."}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border-none outline-none rounded-xl px-4 py-2 text-sm"
          />
          <input 
            type="text"
            value={customJoinCode}
            onChange={(e) => setCustomJoinCode(e.target.value)}
            placeholder={t.customJoinCode + "..."}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border-none outline-none rounded-xl px-4 py-2 text-sm"
          />
          <div className="flex items-center gap-2 px-2">
            <input 
              type="checkbox" 
              id="isPublic"
              checked={isRoomPublic}
              onChange={(e) => setIsRoomPublic(e.target.checked)}
              className="w-4 h-4 accent-green-600"
            />
            <label htmlFor="isPublic" className="text-xs text-zinc-600 dark:text-zinc-400 font-bold">{t.makePublic}</label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreateRoom(false)} className="px-4 py-2 text-xs font-bold text-zinc-500">{t.cancel}</button>
            <button onClick={handleCreateRoom} className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold">{t.create}</button>
          </div>
        </motion.div>
      )}

      {showJoinRoom && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-3"
        >
          <input 
            type="text"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            placeholder={t.enterRoomId + "..."}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border-none outline-none rounded-xl px-4 py-2 text-sm"
          />
          <input 
            type="text"
            value={joinRoomCode}
            onChange={(e) => setJoinRoomCode(e.target.value)}
            placeholder={t.enterCode + "..."}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border-none outline-none rounded-xl px-4 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowJoinRoom(false)} className="px-4 py-2 text-xs font-bold text-zinc-500">{t.cancel}</button>
            <button 
              onClick={() => {
                handleJoinRoom(joinRoomId, joinRoomCode);
                setShowJoinRoom(false);
                setJoinRoomId('');
                setJoinRoomCode('');
              }} 
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
            >
              {t.join}
            </button>
          </div>
        </motion.div>
      )}

      {view === 'rooms' ? (
        activeRoomId ? (
          <div className="flex flex-col h-[600px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl overflow-hidden">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/50">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setActiveRoomId(null)}
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <h4 className="font-bold text-sm flex items-center gap-2">
                    {rooms.find(r => r.id === activeRoomId)?.name}
                    {rooms.find(r => r.id === activeRoomId)?.admins?.includes(user?.uid) && (
                      <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-black">Admin</span>
                    )}
                  </h4>
                  <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">
                    {rooms.find(r => r.id === activeRoomId)?.members.length} {t.members}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {roomMessages.length === 0 ? (
                <div className="text-center py-12 text-zinc-400 italic text-sm">No messages yet. Start the conversation!</div>
              ) : (
                roomMessages.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={cn(
                      "flex gap-2 max-w-[80%]",
                      msg.authorUid === user?.uid ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    <img src={msg.authorPhoto} className="w-8 h-8 rounded-full mt-1" />
                    <div className={cn(
                      "p-3 rounded-2xl text-sm relative group/msg",
                      msg.authorUid === user?.uid 
                        ? "bg-green-600 text-white rounded-tr-none" 
                        : "bg-zinc-100 dark:bg-zinc-800 rounded-tl-none"
                    )}>
                      {msg.authorUid !== user?.uid && (
                        <p className="text-[10px] font-bold opacity-70 mb-1">{msg.authorName}</p>
                      )}
                      <p className="text-left" dir="ltr">{translatedTexts[msg.id] || msg.content}</p>
                      <div className="flex items-center justify-between gap-4 mt-1">
                        <p className={cn(
                          "text-[8px] opacity-50",
                          msg.authorUid === user?.uid ? "text-right" : "text-left"
                        )}>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <div className={cn(
                          "flex items-center gap-2 transition-opacity",
                          msg.authorUid === user?.uid ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
                        )}>
                          <button 
                            onClick={() => handleTranslate(msg.id, msg.content)}
                            className={cn(
                              "text-[8px] font-bold uppercase tracking-tighter hover:underline",
                              msg.authorUid === user?.uid ? "text-white/80" : "text-zinc-500"
                            )}
                          >
                            {isTranslating[msg.id] ? t.translating : translatedTexts[msg.id] ? "Original" : t.translate}
                          </button>
                          {(msg.authorUid === user?.uid || rooms.find(r => r.id === activeRoomId)?.admins?.includes(user?.uid)) && (
                            <button 
                              onClick={() => {
                                console.log("Delete button clicked for message:", msg.id);
                                handleDeleteRoomMessage(msg.id);
                              }}
                              className={cn(
                                "p-1 rounded-md transition-colors",
                                msg.authorUid === user?.uid ? "text-white/80 hover:bg-white/20" : "text-zinc-400 hover:text-red-500 hover:bg-red-50"
                              )}
                              title={t.delete}
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/50">
              <div className="flex gap-2">
                <input 
                  type="text"
                  value={newRoomMessage}
                  onChange={(e) => setNewRoomMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendRoomMessage()}
                  placeholder="Type a message..."
                              className="flex-1 bg-white dark:bg-zinc-800 border-none outline-none rounded-full px-4 py-2 text-sm shadow-inner"
                />
                <button 
                  onClick={handleSendRoomMessage}
                  disabled={!newRoomMessage.trim() || isSending}
                  className="p-2 bg-green-600 text-white rounded-full shadow-lg shadow-green-600/20 hover:scale-110 transition-transform disabled:opacity-50 flex items-center justify-center w-10 h-10 shrink-0"
                >
                  {isSending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-2xl w-fit">
              <button 
                onClick={() => setRoomTab('my')}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                  roomTab === 'my' ? "bg-white dark:bg-zinc-700 text-green-600 shadow-sm" : "text-zinc-500"
                )}
              >
                {t.privateRooms}
              </button>
              <button 
                onClick={() => setRoomTab('discover')}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                  roomTab === 'discover' ? "bg-white dark:bg-zinc-700 text-green-600 shadow-sm" : "text-zinc-500"
                )}
              >
                <Search size={14} />
                {t.discover}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {roomTab === 'my' ? (
                rooms.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400 italic text-sm">{t.noRooms}</div>
                ) : (
                  rooms.map(room => (
                    <div 
                      key={room.id} 
                      onClick={() => setActiveRoomId(room.id)}
                      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl flex flex-col gap-3 group transition-all hover:border-green-500 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center text-green-600">
                            {room.isPublic ? <Globe size={20} /> : <Users size={20} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm">{translatedTexts[room.id] || room.name}</h4>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTranslateRoom(room.id, room.name);
                                }}
                                className="text-zinc-400 hover:text-green-600 transition-colors"
                              >
                                <Languages size={12} />
                              </button>
                            </div>
                            <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">{room.members.length} {t.members}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {room.creator === user?.uid && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRoom(room.id);
                              }}
                              className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                              title="Delete Room"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                          <div className="p-2 text-zinc-400 group-hover:text-green-600 transition-colors">
                            <MessageCircle size={18} />
                          </div>
                        </div>
                      </div>
                      
                      {room.admins?.includes(user?.uid) && room.pendingUids?.length > 0 && (
                        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{t.pendingApproval}</p>
                          {room.pendingUids.map((pUid: string) => (
                            <div key={pUid} className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-xl">
                              <span className="text-xs font-medium truncate max-w-[100px]">{pUid.substring(0, 8)}...</span>
                              <div className="flex gap-1">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleApproveMember(room.id, pUid);
                                  }}
                                  className="px-3 py-1 bg-green-600 text-white text-[10px] font-bold rounded-lg"
                                >
                                  {t.approve}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{t.joinCode}: <span className="text-zinc-800 dark:text-zinc-200 select-all">{room.joinCode}</span></span>
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">ID: <span className="text-zinc-800 dark:text-zinc-200 select-all">{room.id}</span></span>
                      </div>
                    </div>
                  ))
                )
              ) : (
                publicRooms.length === 0 ? (
                  <div className="text-center py-12 text-zinc-400 italic text-sm">{t.noPublicRooms}</div>
                ) : (
                  publicRooms.map(room => (
                    <div 
                      key={room.id} 
                      className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-2xl flex items-center justify-between group transition-all hover:border-green-500"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600">
                          <Globe size={20} />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">{room.name}</h4>
                          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">
                            {room.members?.length || 0} {t.members}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setJoinRoomId(room.id);
                          setShowJoinRoom(true);
                        }}
                        className="px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:scale-105 transition-transform"
                      >
                        {t.join}
                      </button>
                    </div>
                  ))
                )
              )}
            </div>
          </div>
        )
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={post.authorPhoto} alt={post.authorName} className="w-10 h-10 rounded-full" />
                    <div>
                      <h4 className="font-bold text-sm">{post.authorName}</h4>
                      <p className="text-[10px] text-zinc-500">{new Date(post.createdAt).toLocaleDateString(language)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleTranslate(post.id, post.content)}
                      disabled={isAiBusy}
                      className={cn(
                        "p-2 rounded-full transition-colors disabled:opacity-50",
                        translatedTexts[post.id] ? "bg-green-100 text-green-600" : "text-zinc-400 hover:bg-zinc-100"
                      )}
                    >
                      {(isTranslating[post.id] || isAiBusy) ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Languages size={14} />
                      )}
                    </button>
                    {user?.uid === post.authorUid && (
                      <button 
                        onClick={() => handleDeletePost(post.id)}
                        className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm leading-relaxed break-words text-left" dir="ltr">
                  {translatedTexts[post.id] || post.content}
                </p>
                {post.imageUrl && (
                  <div className="rounded-2xl overflow-hidden border border-zinc-100 dark:border-zinc-800">
                    <img src={post.imageUrl} alt="Post content" className="w-full h-auto max-h-[400px] object-cover" referrerPolicy="no-referrer" />
                  </div>
                )}
                <div className="flex items-center gap-6 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <button onClick={() => handleLike(post.id)} className="flex items-center gap-2 text-zinc-500 hover:text-red-500 transition-colors">
                    <Heart size={18} className={post.likes > 0 ? "fill-red-500 text-red-500" : ""} />
                    <span className="text-xs font-bold">{post.likes}</span>
                  </button>
                  <button 
                    onClick={() => {
                      setCommentingOn(commentingOn === post.id ? null : post.id);
                      fetchComments(post.id);
                    }}
                    className="flex items-center gap-2 text-zinc-500 hover:text-blue-500 transition-colors"
                  >
                    <MessageCircle size={18} />
                    <span className="text-xs font-bold">{t.comment}</span>
                  </button>
                  <button className="flex items-center gap-2 text-zinc-500 hover:text-green-500 transition-colors">
                    <Share2 size={18} />
                    <span className="text-xs font-bold">{t.share}</span>
                  </button>
                </div>

                {/* Comments Section */}
                {commentingOn === post.id && (
                  <div className="mt-4 space-y-4 pt-4 border-t border-zinc-50 dark:border-zinc-800/50">
                    <div className="space-y-3">
                      {comments[post.id]?.map((comment) => (
                        <div key={comment.id} className="flex gap-2 group">
                          <img src={comment.authorPhoto} className="w-6 h-6 rounded-full mt-1" />
                          <div className="flex-1">
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-xl relative">
                              <p className="text-[10px] font-bold text-zinc-500">{comment.authorName}</p>
                              <p className="text-xs text-left" dir="ltr">{translatedTexts[comment.id] || comment.content}</p>
                            </div>
                            <div className="flex items-center gap-3 mt-1 ml-1">
                              <button 
                                onClick={() => handleTranslate(comment.id, comment.content)}
                                className="text-[10px] font-bold text-zinc-400 hover:text-green-600"
                              >
                                {isTranslating[comment.id] ? t.translating : translatedTexts[comment.id] ? "Original" : t.translate}
                              </button>
                              {user?.uid === comment.authorUid && (
                                <button 
                                  onClick={() => handleDeleteComment(post.id, comment.id)}
                                  className="text-[10px] font-bold text-zinc-400 hover:text-red-500"
                                >
                                  {t.delete}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {user && (
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Write a comment..."
                          className="flex-1 bg-zinc-100 dark:bg-zinc-800 border-none outline-none rounded-full px-4 py-1.5 text-xs text-left"
                          dir="ltr"
                          disabled={isSending}
                          onKeyDown={(e) => e.key === 'Enter' && handleComment(post.id)}
                        />
                        <button 
                          onClick={() => handleComment(post.id)}
                          disabled={!newComment.trim() || isSending}
                          className="w-8 h-8 flex items-center justify-center bg-green-600 text-white rounded-full disabled:opacity-50 shrink-0"
                        >
                          {isSending ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {user && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-3xl shadow-sm mt-8">
              <textarea 
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                placeholder={t.postSomething}
                className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 rounded-2xl outline-none resize-none text-sm min-h-[100px] p-4 text-left shadow-inner"
                dir="ltr"
              />
              
              {selectedImage && (
                <div className="relative mt-2 mb-4 w-fit">
                  <img src={selectedImage} alt="Preview" className="max-h-48 rounded-2xl border border-zinc-100 dark:border-zinc-800" />
                  <button 
                    onClick={() => setSelectedImage(null)}
                    className="absolute -top-2 -right-2 bg-red-500 text-white p-1 rounded-full shadow-lg hover:bg-red-600 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center mt-2">
                <div className="flex items-center gap-2">
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                    accept="image/*"
                    className="hidden"
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isSending}
                    className="w-10 h-10 flex items-center justify-center text-green-600 bg-green-50 dark:bg-green-900/20 rounded-xl hover:bg-green-100 transition-colors disabled:opacity-50"
                    title="Upload Photo"
                  >
                    {isUploading ? <RefreshCw size={20} className="animate-spin" /> : <Camera size={20} />}
                  </button>
                </div>
                <button 
                  onClick={handlePost}
                  disabled={(!newPost.trim() && !selectedImage) || isUploading || isSending}
                  className="bg-green-600 text-white px-6 py-2 rounded-full text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2 min-w-[100px] justify-center"
                >
                  {isSending ? <RefreshCw size={14} className="animate-spin" /> : t.post}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

function SettingsView({ 
  language, 
  setLanguage, 
  user, 
  theme, 
  toggleTheme,
  profile,
  toggleNotifications,
  isAdmin,
  appLogo
}: { 
  language: Language, 
  setLanguage: (l: Language) => void, 
  user: User | null,
  theme: Theme,
  toggleTheme: () => void,
  profile: UserProfile | null,
  toggleNotifications: () => void,
  isAdmin: boolean,
  appLogo: string | null
}) {
  const t = TRANSLATIONS[language];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isAdmin) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      try {
        const compressed = await compressImage(base64, 400, 0.5); // Aggressive compression for logo
        await setDoc(doc(db, 'settings', 'app'), { logoUrl: compressed }, { merge: true });
        toast.success(t.logoUpdated);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'settings/app');
        toast.error(t.failedToUpdate);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'rw', name: 'Kinyarwanda' },
    { code: 'fr', name: 'Français' },
    { code: 'sw', name: 'Kiswahili' },
    { code: 'es', name: 'Español' },
    { code: 'pt', name: 'Português' },
    { code: 'zh', name: '中文' },
    { code: 'ar', name: 'العربية' },
    { code: 'hi', name: 'हिन्दी' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'ru', name: 'Русский' }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl space-y-6">
        {/* Appearance Section */}
        <div>
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">{t.appearance}</h3>
          <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center text-green-600">
                {theme === 'light' ? <Sun size={20} /> : <Moon size={20} />}
              </div>
              <div>
                <p className="font-bold text-sm">{t.theme}</p>
                <p className="text-xs text-zinc-500">{theme === 'light' ? t.lightMode : t.darkMode}</p>
              </div>
            </div>
            <button 
              onClick={toggleTheme} 
              className="relative w-12 h-6 bg-zinc-200 dark:bg-zinc-700 rounded-full p-1 transition-colors duration-300 flex items-center"
            >
              <motion.div
                animate={{ x: theme === 'light' ? 0 : 24 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="w-4 h-4 bg-white dark:bg-green-500 rounded-full shadow-sm"
              />
            </button>
          </div>
        </div>

        {/* Notifications Section */}
        <div>
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">{t.notifications}</h3>
          <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600">
                <Bell size={20} />
              </div>
              <div>
                <p className="font-bold text-sm">{t.notifications}</p>
                <p className="text-xs text-zinc-500">{t.enableNotifications}</p>
              </div>
            </div>
            <button 
              onClick={toggleNotifications} 
              className={cn(
                "relative w-12 h-6 rounded-full p-1 transition-all duration-500 flex items-center",
                profile?.notificationsEnabled ? "bg-green-600 shadow-lg shadow-green-600/30" : "bg-zinc-200 dark:bg-zinc-700"
              )}
            >
              <motion.div
                layout
                animate={{ 
                  x: profile?.notificationsEnabled ? 24 : 0,
                  scale: [1, 1.2, 1]
                }}
                transition={{ 
                  type: "spring", 
                  stiffness: 500, 
                  damping: 30,
                  scale: { duration: 0.2 }
                }}
                className="w-4 h-4 bg-white rounded-full shadow-sm"
              />
            </button>
          </div>
        </div>

        {/* Language Section */}
        <div>
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">{t.language}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {languages.map((lang) => (
              <button 
                key={lang.code}
                onClick={() => setLanguage(lang.code as Language)}
                className={cn(
                  "py-3 rounded-xl text-sm font-bold border transition-all",
                  language === lang.code 
                    ? "bg-green-600 border-green-600 text-white shadow-lg shadow-green-600/20" 
                    : "bg-transparent border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-green-500"
                )}
              >
                {lang.name}
              </button>
            ))}
          </div>
        </div>

        {/* AI Diagnostics Section */}
        <div>
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">AI Service Health</h3>
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-100 dark:border-zinc-800 space-y-4">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <ShieldCheck size={20} className="text-green-600" />
                   <div>
                     <p className="text-sm font-bold">System Connection</p>
                     <p className="text-[10px] text-zinc-500">Verify API key status & reset engine</p>
                   </div>
                </div>
                <button 
                  onClick={async () => {
                    const checkToast = toast.loading("Checking AI engine status...");
                    try {
                      await resetAiEngine();
                      const state = await isAiConfigured();
                      toast.dismiss(checkToast);
                      if (state) {
                        toast.success("AI Service is ONLINE. Key detected successfully.");
                      } else {
                        toast.error("AI Service OFFLINE. Missing GEMINI_API_KEY in hosting settings.");
                      }
                    } catch (e) {
                      toast.dismiss(checkToast);
                      toast.error("Diagnostic failed. Network connection error.");
                    }
                  }}
                  className="px-4 py-2 bg-zinc-200 dark:bg-zinc-700 rounded-xl text-[10px] font-bold uppercase transition-all hover:bg-green-600 hover:text-white"
                >
                  Run Test
                </button>
             </div>
          </div>
        </div>

        {user && (
          <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
            <button 
              onClick={() => signOut(auth)}
              className="w-full flex items-center justify-center gap-2 text-red-500 font-bold py-3 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-colors"
            >
              <LogOut size={20} />
              {t.logout}
            </button>
          </div>
        )}

        <div className="pt-4 text-center">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">made by hirwa prince</p>
        </div>
      </div>
    </motion.div>
  );
}
