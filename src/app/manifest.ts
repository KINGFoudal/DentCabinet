import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nimba Dentaire",
    short_name: "Nimba",
    description: "Gestion de cabinet dentaire",
    start_url: "/app",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    lang: "fr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
