import type { AppSettings } from "@/lib/app-settings";

export const fallbackIcons = {
  favicon: "/icons/premios-ao-vivo-favicon-32.png",
  icon192: "/icons/premios-ao-vivo-icon-192.png",
  icon512: "/icons/premios-ao-vivo-icon-512.png",
};

const publicStorage = "https://myivwdbnpbuooncehwds.supabase.co/storage/v1/object/public/app-assets";
const previousIcons = {
  favicon: `${publicStorage}/favicon/1782871727671-4b66152b-ee5b-46df-ab69-eae9ed9e7616-favicon_premios_ao_vivo_32x32.png`,
  icon192: `${publicStorage}/icon192/1782878823648-d89795ab-636e-4519-b63d-5c143feff32d-192.png`,
  icon512: `${publicStorage}/icon512/1782876750164-a2e07d3a-9bc9-472d-a8b3-48f571efe300-512.png`,
};

type PwaIconSettings = Partial<Pick<AppSettings, "faviconUrl" | "icon192Url" | "icon512Url">>;

function currentIcon(configured: string | undefined, previous: string, fallback: string, placeholder?: string) {
  return configured && configured !== previous && configured !== placeholder ? configured : fallback;
}

export function getPwaIcons(settings: PwaIconSettings) {
  // Keep the stored values available to the panel and honor any later asset upload.
  return {
    favicon: currentIcon(settings.faviconUrl, previousIcons.favicon, fallbackIcons.favicon),
    icon192: currentIcon(settings.icon192Url, previousIcons.icon192, fallbackIcons.icon192, "/icons/icon-192.svg"),
    icon512: currentIcon(settings.icon512Url, previousIcons.icon512, fallbackIcons.icon512, "/icons/icon-512.svg"),
  };
}
