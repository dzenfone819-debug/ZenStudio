import React from "react";
import ReactDOM from "react-dom/client";
import "@blocknote/mantine/style.css";

import App from "./App";
import "./styles/scrollbars.css";
import "./styles.css";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
