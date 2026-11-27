import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fallbackIcons, getPwaIcons } from "../lib/pwa-icon-assets.ts";
import {
  detectInstallPlatform,
  getInstallUrl,
  getReadableTextColor,
  isIosSafari,
  isStandaloneMode,
} from "../lib/pwa-install.ts";

const installPageSource = readFileSync("app/instalar/page.tsx", "utf8");
const installComponentSource = readFileSync("components/pwa-install-page.tsx", "utf8");
const homeSource = readFileSync("app/page.tsx", "utf8");
const layoutSource = readFileSync("app/layout.tsx", "utf8");
const splashSource = readFileSync("components/native-splash.tsx", "utf8");
const splashStyles = readFileSync("components/native-splash.module.css", "utf8");
const manifestSource = readFileSync("app/manifest.ts", "utf8");
const serviceWorkerSource = readFileSync("public/sw.js", "utf8");
const notificationBannerSource = readFileSync("components/notification-vip-banner.tsx", "utf8");
const oneSignalInitializerSource = readFileSync("components/onesignal-initializer.tsx", "utf8");

test("the offline launcher stays open and reloads settings when connectivity changes", () => {
  assert.match(homeSource, /useSyncExternalStore\(subscribeToConnection, \(\) => navigator\.onLine/);
  assert.match(homeSource, /if \(!navigator\.onLine \|\| hasRedirected\.current\) return/);
  assert.match(homeSource, /if \(!isOnline\) return;[\s\S]*fetch\("\/api\/settings"[\s\S]*\}, \[isOnline\]\)/);
});

test("the approved brand icons replace legacy assets and later panel uploads take precedence", () => {
  const legacy = "https://myivwdbnpbuooncehwds.supabase.co/storage/v1/object/public/app-assets";
  assert.deepEqual(getPwaIcons({
    faviconUrl: `${legacy}/favicon/1782871727671-4b66152b-ee5b-46df-ab69-eae9ed9e7616-favicon_premios_ao_vivo_32x32.png`,
    icon192Url: `${legacy}/icon192/1782878823648-d89795ab-636e-4519-b63d-5c143feff32d-192.png`,
    icon512Url: `${legacy}/icon512/1782876750164-a2e07d3a-9bc9-472d-a8b3-48f571efe300-512.png`,
  }), fallbackIcons);
  assert.deepEqual(getPwaIcons({ icon192Url: "/icons/icon-192.svg", icon512Url: "/icons/icon-512.svg" }), fallbackIcons);
  const newer = "https://assets.example.invalid/new-icon.png";
  assert.deepEqual(getPwaIcons({ faviconUrl: newer, icon192Url: newer, icon512Url: newer }), {
    favicon: newer, icon192: newer, icon512: newer,
  });
});

test("platform detection covers Android, iOS including iPad desktop mode, and desktop", () => {
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Linux; Android 15) Chrome/140"), "android");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), "ios");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Macintosh)", "MacIntel", 5), "ios");
  assert.equal(detectInstallPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
});

test("standalone detection accepts both display-mode and the iOS navigator flag", () => {
  assert.equal(isStandaloneMode(true, false), true);
  assert.equal(isStandaloneMode(false, true), true);
  assert.equal(isStandaloneMode(false, false), false);
});

test("iOS Safari detection excludes other browsers and embedded browsers", () => {
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Version/26.0 Mobile/15E148 Safari/604.1";
  assert.equal(isIosSafari(safari), true);
  assert.equal(isIosSafari(safari.replace("Version/26.0", "CriOS/140.0")), false);
  assert.equal(isIosSafari(`${safari} Instagram 400`), false);
});

test("the manual install address uses the configured PWA origin and dedicated route", () => {
  assert.equal(getInstallUrl("https://pwa.example.com/landing?campaign=a"), "https://pwa.example.com/instalar");
  assert.equal(getInstallUrl("http://localhost:3000/"), "http://localhost:3000/instalar");
  assert.equal(getInstallUrl("ftp://example.com/"), undefined);
  assert.equal(getInstallUrl(""), undefined);
});

test("brand button text keeps readable contrast for light and dark colors", () => {
  assert.equal(getReadableTextColor("#ffffff"), "#111827");
  assert.equal(getReadableTextColor("#000000"), "#ffffff");
  assert.equal(getReadableTextColor("#fff"), "#111827");
  assert.equal(getReadableTextColor("not-a-color"), "#ffffff");
});

test("the dedicated install route is isolated from the public launcher redirect", () => {
  assert.match(installPageSource, /PwaInstallPage/);
  assert.doesNotMatch(installPageSource, /NEXT_PUBLIC_PLATFORM_URL|window\.location|redirectToPlatform/);
  assert.match(homeSource, /window\.location\.assign\(url\)/);
  assert.match(homeSource, /setTimeout\(\(\) => redirectToPlatform\(openUrl\), settings\.redirectDelayMs\)/);
});

test("the launcher always renders the native splash and leaves legacy HTML inert", () => {
  assert.match(homeSource, /<NativeSplash\b/);
  assert.doesNotMatch(homeSource + splashSource, /splashHtmlUrl|<iframe|srcDoc|dangerouslySetInnerHTML|\bBlob\b/);
  assert.match(homeSource, /fetch\("\/api\/settings"/);
  assert.match(homeSource, /hasRedirected\.current = true;\s+window\.location\.assign\(url\)/);
  assert.match(homeSource, /addEventListener\("push-sync-settled", onPushSyncSettled\)/);
  assert.match(homeSource, /redirectToPlatform\(openUrl\)/);
});

test("the VIP offer uses live launcher settings and preserves the time to opt in", () => {
  assert.doesNotMatch(layoutSource, /NotificationVipBanner/);
  assert.match(homeSource, /settings\.notificationsEnabled\s*&&\s*\(\s*<NotificationVipBanner/);
  assert.match(homeSource, /detail\?\.ok === true\) \{\s+redirectToPlatform\(openUrl\)/);
  assert.match(homeSource, /activatingNotifications\s*\? undefined\s*:\s*window\.setTimeout/);
  assert.match(notificationBannerSource, /pathname !== "\/"/);
  assert.match(notificationBannerSource, /!\(id && optedIn\)/);
  assert.match(oneSignalInitializerSource, /Notification\.permission === "granted"\) \{\s+await OneSignal\.User\.PushSubscription\.optIn\(\)/);
  assert.match(oneSignalInitializerSource, /return OneSignal\.Notifications\.requestPermission\(\)/);
});

test("splash separates logo and artwork and retains accessible controls with reduced motion", () => {
  assert.match(splashSource, /imageSource\(splashImageUrl\)/);
  assert.match(splashSource, /<Image alt="" className=\{styles\.artwork\}[^>]+src=\{artwork\}/);
  assert.match(splashSource, /<SplashMark[^>]+logo=\{logo\}/);
  assert.match(splashSource, /<p role="status">/);
  assert.match(splashSource, />Abrir agora</);
  assert.match(splashSource, />Suporte</);
  assert.match(splashStyles, /\.primary:focus-visible/);
  assert.match(splashStyles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation: none/);
});

test("installation is requested only from the explicit user action", () => {
  assert.match(installComponentSource, /addEventListener\("beforeinstallprompt"/);
  assert.match(installComponentSource, /event\.preventDefault\(\)/);
  assert.match(installComponentSource, /onClick=\{requestInstall\}/);
  assert.match(installComponentSource, /await installPrompt\.prompt\(\)/);
  assert.match(installComponentSource, /await installPrompt\.userChoice/);
  assert.match(installComponentSource, /addEventListener\("appinstalled"/);
});

test("standalone and no-prompt states have explicit safe fallbacks", () => {
  assert.match(installComponentSource, /display-mode: standalone/);
  assert.match(installComponentSource, /Abrir aplicativo/);
  assert.match(installComponentSource, /Ver como instalar/);
  assert.match(installComponentSource, /Copie este endereço e cole no Safari/);
  assert.match(installComponentSource, /Adicionar à Tela de Início/);
});

test("the installation center uses only the supplied brand's app icon", () => {
  assert.doesNotMatch(installComponentSource, /bigpix|apkbig|placeholder/i);
  assert.doesNotMatch(installPageSource, /megabingo7|bigpix|installBrandByDomain/i);
  assert.match(installPageSource, /name: settings[.]appShortName/);
  assert.match(installPageSource, /themeColor: settings[.]themeColor/);
  assert.match(installPageSource, /backgroundColor: settings[.]backgroundColor/);
  const images = installComponentSource.match(/<Image\b[^>]*>/g) ?? [];
  assert.equal(images.length, 1);
  assert.match(images[0], /src=\{brand\.iconUrl\}/);
});

test("manifest, service worker and OneSignal integration invariants remain intact", () => {
  assert.match(oneSignalInitializerSource, /serviceWorkerOverrideForTypical: true/);
  assert.match(oneSignalInitializerSource, /serviceWorkerParam: \{ scope: "\/onesignal\/" \}/);
  assert.match(oneSignalInitializerSource, /serviceWorkerPath: "OneSignalSDKWorker\.js"/);
  assert.match(manifestSource, /start_url: "\/"/);
  assert.match(manifestSource, /display: "standalone"/);
  assert.match(manifestSource, /src: icon512Src,\s*sizes: "512x512",\s*type: getMimeType\(icon512Src\),\s*purpose: "any"/);
  assert.match(serviceWorkerSource, /const CACHE_NAME = CACHE_PREFIX \+ "v3"/);
  assert.match(serviceWorkerSource, /const LEGACY_CACHE_NAME = CACHE_PREFIX \+ "v2"/);
  assert.match(serviceWorkerSource, /const OFFLINE_FALLBACK_URL = "\/pwa-offline"/);
  assert.match(serviceWorkerSource, /const MANIFEST_URL = "\/manifest\.webmanifest"/);
});
