import type { Metadata, Viewport } from "next";
import "./globals.css";
import { OneSignalInitializer } from "@/components/onesignal-initializer";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { getAppSettings } from "@/lib/app-settings.server";
import { getPwaIcons } from "@/lib/pwa-icon-assets";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getAppSettings();
  const icons = getPwaIcons(settings);

  return {
    title: settings.appName,
    description: settings.appDescription,
    applicationName: settings.appName,
    manifest: "/manifest.webmanifest",
    metadataBase: settings.publicUrl ? new URL(settings.publicUrl) : undefined,
    icons: {
      icon: icons.favicon,
      apple: {
        url: icons.icon192,
        sizes: "192x192",
      },
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: settings.appShortName,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const settings = await getAppSettings();

  return {
    themeColor: settings.themeColor,
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getAppSettings();

  return (
    <html lang="pt-BR">
      <head>
        <link
          rel="apple-touch-icon"
          sizes="192x192"
          href={getPwaIcons(settings).icon192}
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        <OneSignalInitializer />
        {children}
      </body>
    </html>
  );
}
