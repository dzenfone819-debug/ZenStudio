import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@blocknote/mantine/style.css";
import "@fontsource-variable/onest/wght.css";
import "@fontsource-variable/unbounded/wght.css";
import "@fontsource-variable/golos-text/wght.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/cyrillic-400.css";
import "@fontsource/ibm-plex-sans/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/cyrillic-500.css";
import "@fontsource/ibm-plex-sans/latin-500-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-500-italic.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/cyrillic-600.css";
import "@fontsource/ibm-plex-sans/latin-600-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-600-italic.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-sans/cyrillic-700.css";
import "@fontsource/ibm-plex-sans/latin-700-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-700-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/cyrillic-400.css";
import "@fontsource/ibm-plex-mono/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/cyrillic-500.css";
import "@fontsource/ibm-plex-mono/latin-500-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-500-italic.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/cyrillic-600.css";
import "@fontsource/ibm-plex-mono/latin-600-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-600-italic.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "@fontsource/ibm-plex-mono/cyrillic-700.css";
import "@fontsource/ibm-plex-mono/latin-700-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-700-italic.css";
import "@fontsource/ibm-plex-serif/latin-400.css";
import "@fontsource/ibm-plex-serif/cyrillic-400.css";
import "@fontsource/ibm-plex-serif/latin-400-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-400-italic.css";
import "@fontsource/ibm-plex-serif/latin-500.css";
import "@fontsource/ibm-plex-serif/cyrillic-500.css";
import "@fontsource/ibm-plex-serif/latin-500-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-500-italic.css";
import "@fontsource/ibm-plex-serif/latin-600.css";
import "@fontsource/ibm-plex-serif/cyrillic-600.css";
import "@fontsource/ibm-plex-serif/latin-600-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-600-italic.css";
import "@fontsource/ibm-plex-serif/latin-700.css";
import "@fontsource/ibm-plex-serif/cyrillic-700.css";
import "@fontsource/ibm-plex-serif/latin-700-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-700-italic.css";

import App from "./App";
import "./styles/scrollbars.css";
import "./styles.css";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider>
      <App />
    </MantineProvider>
  </React.StrictMode>
);
