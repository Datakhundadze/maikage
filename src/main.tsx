import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const savedTheme = (localStorage.getItem("maika-theme") as "dark" | "green") || "dark";
document.documentElement.classList.add(savedTheme);

createRoot(document.getElementById("root")!).render(<App />);
