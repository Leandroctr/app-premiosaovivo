"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { NativeSplash } from "@/components/native-splash";
import { NotificationButton } from "@/components/notification-button";
import { NotificationVipBanner } from "@/components/notification-vip-banner";
import { appConfigClient } from "@/lib/app-config.client";
import type { AppSettings } from "@/lib/app-settings";
import { fallbackIcons, getPwaIcons } from "@/lib/pwa-icon-assets";

type LauncherSettings = Pick<AppSettings,
  "appName" | "logoUrl" | "icon192Url" | "icon512Url" | "splashImageUrl" |
  "themeColor" | "backgroundColor" | "splashTitle" | "splashMessage" |
  "platformUrl" | "supportUrl" | "redirectDelayMs" | "notificationsEnabled"
>;

const fallbackSettings: LauncherSettings = {
  appName: appConfigClient.appName,
  platformUrl: appConfigClient.platformUrl,
  supportUrl: appConfigClient.supportUrl,
  logoUrl: appConfigClient.logoUrl,
  icon192Url: fallbackIcons.icon192,
  icon512Url: fallbackIcons.icon512,
  themeColor: appConfigClient.themeColor,
  backgroundColor: appConfigClient.backgroundColor,
  splashTitle: appConfigClient.appName,
  splashMessage: "Carregando ambiente seguro...",
  splashImageUrl: appConfigClient.splashImageUrl,
  redirectDelayMs: 1500,
  notificationsEnabled: false,
};

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export default function Home() {
  const isOnline = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true);
  const [resolvedSettings, setResolvedSettings] = useState<LauncherSettings | null>(null);
  const [activatingNotifications, setActivatingNotifications] = useState(false);
  const hasRedirected = useRef(false);
  const settings = resolvedSettings ?? fallbackSettings;
  const platformUrl = resolvedSettings?.platformUrl.trim();
  const openUrl = isOnline && platformUrl && platformUrl !== "#" ? platformUrl : undefined;

  const redirectToPlatform = useCallback((url: string) => {
    if (!navigator.onLine || hasRedirected.current) return;
    hasRedirected.current = true;
    window.location.assign(url);
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    const controller = new AbortController();
    const settingsTimer = window.setTimeout(() => controller.abort(), 5000);
    let active = true;

    async function loadSettings() {
      let loaded = fallbackSettings;
      try {
        const response = await fetch("/api/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (response.ok && result?.settings) loaded = result.settings;
      } catch {
        // The bundled settings keep the launcher available when the network fails.
      } finally {
        window.clearTimeout(settingsTimer);
      }
      if (active) setResolvedSettings(loaded);
    }

    void loadSettings();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(settingsTimer);
    };
  }, [isOnline]);

  useEffect(() => {
    if (!openUrl) return;

    const onPushSyncSettled = (event: Event) => {
      if ((event as CustomEvent<{ ok: boolean }>).detail?.ok === true) {
        redirectToPlatform(openUrl);
      }
    };

    window.addEventListener("push-sync-settled", onPushSyncSettled);
    const redirectTimer = activatingNotifications
      ? undefined
      : window.setTimeout(() => redirectToPlatform(openUrl), settings.redirectDelayMs);
    return () => {
      window.removeEventListener("push-sync-settled", onPushSyncSettled);
      window.clearTimeout(redirectTimer);
    };
  }, [activatingNotifications, openUrl, redirectToPlatform, settings.redirectDelayMs]);

  function openNow(event: MouseEvent<HTMLAnchorElement>) {
    if (!openUrl || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    redirectToPlatform(openUrl);
  }

  return (
    <>
      {settings.notificationsEnabled && (
        <NotificationVipBanner
          activating={activatingNotifications}
          onActivationChange={setActivatingNotifications}
        />
      )}
      <NativeSplash
        appName={settings.appName}
        logoUrl={settings.logoUrl}
        iconUrl={getPwaIcons(settings).icon512}
        offlineIconUrl={isOnline ? undefined : fallbackIcons.icon512}
        splashImageUrl={settings.splashImageUrl}
        themeColor={settings.themeColor}
        backgroundColor={settings.backgroundColor}
        splashTitle={settings.splashTitle}
        splashMessage={isOnline ? settings.splashMessage : "Sem conexão. Aguarde a internet voltar."}
        openUrl={openUrl}
        supportUrl={settings.supportUrl}
        hasPlatformError={isOnline && resolvedSettings !== null && !openUrl}
        onOpen={openNow}
      >
        {settings.notificationsEnabled && (
          <details className="mt-1">
            <summary className="cursor-pointer rounded px-3 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-2">
              Notificações
            </summary>
            <div className="mx-auto mt-2 w-fit max-w-full">
              <NotificationButton
                activating={activatingNotifications}
                onActivationChange={setActivatingNotifications}
                themeColor={settings.themeColor}
              />
            </div>
          </details>
        )}
      </NativeSplash>
    </>
  );
}
