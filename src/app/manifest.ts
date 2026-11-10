import type { MetadataRoute } from "next";
import { colors } from "@/styles/design-tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CLUB JOIA 300",
    short_name: "JOIA 300",
    description: "Your private CLUB JOIA 300 membership.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: colors.ink,
    theme_color: colors.ink,
    categories: ["lifestyle", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My tickets", url: "/tickets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Membership card", url: "/card", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Concierge", url: "/concierge", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
