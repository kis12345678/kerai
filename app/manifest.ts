import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kerai AI",
    short_name: "Kerai AI",
    description: "A local AI workspace that auto-detects what you need — running on your own GPU via Ollama.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#05080f",
    theme_color: "#05080f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  };
}
