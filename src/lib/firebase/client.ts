"use client";

import { FirebaseApp, getApp, getApps, initializeApp } from "@firebase/app";
import {
  AppCheck,
  getLimitedUseToken,
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "@firebase/app-check";
import { Auth, getAuth } from "@firebase/auth";

interface ClientServices {
  app: FirebaseApp;
  auth: Auth;
  appCheck: AppCheck;
}

let services: ClientServices | undefined;

export function firebaseClientConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID &&
    process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY,
  );
}

export function getFirebaseClient(): ClientServices {
  if (services) return services;
  if (!firebaseClientConfigured()) {
    throw new Error("Firebase Auth and App Check are not configured.");
  }

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(
      process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY!,
    ),
    isTokenAutoRefreshEnabled: true,
  });

  services = { app, auth: getAuth(app), appCheck };
  return services;
}

export async function getLimitedAppCheckToken(): Promise<string> {
  const { appCheck } = getFirebaseClient();
  return (await getLimitedUseToken(appCheck)).token;
}
