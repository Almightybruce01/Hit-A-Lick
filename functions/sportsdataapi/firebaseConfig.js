import admin from "firebase-admin";

// Convert escaped "\n" to actual newlines for optional local cert auth.
const cleanPrivateKey = process.env.HAL_FIREBASE_PRIVATE_KEY
  ? process.env.HAL_FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  : undefined;

// Prevent multiple initializations
if (!admin.apps.length) {
  console.log("🔥 Initializing Firebase Admin (Serverless Mode)");

  if (
    process.env.HAL_FIREBASE_PROJECT_ID &&
    process.env.HAL_FIREBASE_CLIENT_EMAIL &&
    cleanPrivateKey
  ) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.HAL_FIREBASE_PROJECT_ID,
        clientEmail: process.env.HAL_FIREBASE_CLIENT_EMAIL,
        privateKey: cleanPrivateKey,
      }),
    });
  } else {
    // In Firebase/GCP runtime, default credentials are available automatically.
    admin.initializeApp();
  }
}

// Firestore reference
const db = admin.firestore();

export { db, admin };