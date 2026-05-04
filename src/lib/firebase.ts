import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Log config for debugging
console.log('Firebase Init:', {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId || '(default)'
});

// We'll use a getter to allow fallback if needed, but for now we stick to the config
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);

// Disable persistence temporarily as it can cause 'unavailable' errors in some sandbox environments
// if (typeof window !== 'undefined') { ... }

export const googleProvider = new GoogleAuthProvider();

// CRITICAL: Connectivity check to detect provisioning issues early
async function testFirestoreConnection() {
  if (typeof window === 'undefined') return;
  try {
    const { doc, getDocFromServer, setDoc } = await import('firebase/firestore');
    
    // Try to write a timestamp to verify write access too
    console.log('Testing Firestore connection to path: _system_/connectivity');
    // We use getDocFromServer to force a network hit
    const snap = await getDocFromServer(doc(db, '_system_', 'connectivity'));
    console.log('Firestore reached. Exists:', snap.exists());
  } catch (error: any) {
    console.error('Firestore Test Error:', error);
    if (error.message?.includes('offline') || error.code === 'unavailable') {
      console.error('Firestore connectivity test failed: The client is offline. This usually indicates an incorrect configuration or provisioning issue.');
    } else if (error.code === 'permission-denied') {
      console.log('Firestore reached but permission denied (This is expected if __ready__/check is not publicly readable).');
    }
  }
}
testFirestoreConnection();
