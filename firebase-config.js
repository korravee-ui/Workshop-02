import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBTFfdecw4yh9UNzl71W-h0zagG2lXT1zU",
  authDomain: "korworkshop-1cd5d.firebaseapp.com",
  projectId: "korworkshop-1cd5d",
  storageBucket: "korworkshop-1cd5d.firebasestorage.app",
  messagingSenderId: "277442033808",
  appId: "1:277442033808:web:a02afed81f1672a10d0015",
  measurementId: "G-WJ317Q2L72"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
