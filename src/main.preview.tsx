import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import App from "./App";
import { registerWebMCP } from "./webmcp";
registerWebMCP();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
