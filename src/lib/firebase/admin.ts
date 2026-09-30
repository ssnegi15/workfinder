import "server-only";

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("Firebase project ID is not configured.");

  return initializeApp({ credential: applicationDefault(), projectId });
}

export function getFirebaseAdmin() {
  const app = getAdminApp();
  return {
    appCheck: getAppCheck(app),
    auth: getAuth(app),
    firestore: getFirestore(app),
  };
}
