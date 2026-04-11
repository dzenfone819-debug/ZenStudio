import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg"],
            manifest: {
                name: "Zen Notes",
                short_name: "Zen Notes",
                description: "Offline-first rich text notes with folders, tags, and optional sync.",
                theme_color: "#161338",
                background_color: "#0d0a24",
                display: "standalone",
                orientation: "any",
                lang: "en",
                icons: [
                    {
                        src: "/pwa-icon.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "any"
                    },
                    {
                        src: "/mask-icon.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "maskable"
                    }
                ]
            }
        })
    ],
    server: {
        port: 4173
    }
});
