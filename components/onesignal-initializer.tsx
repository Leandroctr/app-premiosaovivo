"use client";

import { useEffect } from "react";
import OneSignal from "react-onesignal";

declare global {
  interface Window {
    __ONESIGNAL_INITED__?: boolean;
  }
}

const isDevelopment = process.env.NODE_ENV !== "production";
let oneSignalReady = false;

export function isOneSignalReady() {
  return oneSignalReady;
}

export async function requestPushSubscription() {
  if (!oneSignalReady || typeof Notification === "undefined" || Notification.permission === "denied") {
    return false;
  }
  if (Notification.permission === "granted") {
    await OneSignal.User.PushSubscription.optIn();
    return true;
  }
  return OneSignal.Notifications.requestPermission();
}

function debugLog(message: string, metadata?: Record<string, unknown>) {
  if (isDevelopment) {
    console.log("[OS]", message, metadata ?? "");
  }
}

function debugWarn(message: string) {
  if (isDevelopment) {
    console.warn("[OS]", message);
  }
}

function debugError(message: string, error?: unknown) {
  if (isDevelopment) {
    const candidate = error instanceof Error ? error.name : "UnknownError";
    const errorName = /^[a-zA-Z0-9._:-]+$/.test(candidate)
      ? candidate.slice(0, 64)
      : "UnknownError";
    console.error("[OS]", message, {
      errorName,
    });
  }
}

// Sem inscrição ativa ou com falha, o launcher mantém seu temporizador.
function dispatchPushSyncSettled(ok: boolean) {
  window.dispatchEvent(new CustomEvent("push-sync-settled", { detail: { ok } }));
}

async function sendSubscription(id: string): Promise<boolean> {
  try {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // keepalive garante que a requisicao nao seja abortada pelo navegador
      // se o redirect de topo para platformUrl disparar logo em seguida.
      keepalive: true,
      body: JSON.stringify({
        onesignalId: id,
        permissionStatus: Notification.permission,
        userAgent: navigator.userAgent,
        deviceType: "web",
      }),
    });

    return response.ok;
  } catch (err) {
    debugError("Falha ao sincronizar inscricao push.", err);
    return false;
  }
}

export function OneSignalInitializer() {
  useEffect(() => {
    if (window.__ONESIGNAL_INITED__) return;
    window.__ONESIGNAL_INITED__ = true;

    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;

    debugLog("OneSignal init start.", {
      hasAppId: Boolean(appId),
      serviceWorkerSupported: "serviceWorker" in navigator,
      notificationSupported: "Notification" in window,
    });

    if (!appId) {
      debugWarn("OneSignal App ID ausente; inicializacao cancelada.");
      dispatchPushSyncSettled(false);
      return;
    }

    debugLog("Calling OneSignal.init().");

    void OneSignal.init({
      appId,
      autoResubscribe: true,
      // Keep the existing worker URL for subscribers and reserve root scope for the PWA worker.
      serviceWorkerOverrideForTypical: true,
      serviceWorkerParam: { scope: "/onesignal/" },
      serviceWorkerPath: "OneSignalSDKWorker.js",
    }).then(async () => {
      debugLog("OneSignal init resolved.", {
        hasActiveSubscription: Boolean(OneSignal.User.PushSubscription.id),
        optedIn: OneSignal.User.PushSubscription.optedIn,
        permission: OneSignal.Notifications.permission,
      });

      OneSignal.User.PushSubscription.addEventListener("change", (event) => {
        const { id, optedIn } = event.current;
        debugLog("Push subscription state changed.", {
          hasSubscriptionId: Boolean(id),
          optedIn,
        });
        if (id && optedIn) {
          void sendSubscription(id).then((ok) => {
            debugLog(ok ? "Subscription sync succeeded." : "Subscription sync failed.");
            dispatchPushSyncSettled(ok);
          });
        }
      });

      const currentId = OneSignal.User.PushSubscription.id;
      const currentOptedIn = OneSignal.User.PushSubscription.optedIn;
      oneSignalReady = true;

      if (currentId && currentOptedIn) {
        debugLog("Active subscription found; syncing.");
        const ok = await sendSubscription(currentId);
        debugLog(ok ? "Initial subscription sync succeeded." : "Initial subscription sync failed.");
        dispatchPushSyncSettled(ok);
      } else {
        debugLog("No active subscription to sync.");
        dispatchPushSyncSettled(false);
      }
    }).catch((error: unknown) => {
      debugError("OneSignal init failed.", error);
      dispatchPushSyncSettled(false);
    });
  }, []);

  return null;
}
