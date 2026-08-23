import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBfwXMk2EOPj7St_47y9zXaHSne-kDucTU",
  authDomain: "dolan-sawah-ai-2026.firebaseapp.com",
  projectId: "dolan-sawah-ai-2026",
  storageBucket: "dolan-sawah-ai-2026.firebasestorage.app",
  messagingSenderId: "193012541967",
  appId: "1:193012541967:web:6446f5571ad39764f4117a"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
