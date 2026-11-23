import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { forgetShowroomSeed, seedWantsShowroomLook } from "./lib/constructorSeed";

const savedTheme = (localStorage.getItem("maika-theme") as "dark" | "green") || "dark";
document.documentElement.classList.add(savedTheme);

// A showroom order opens the constructor in a new tab: its look is set before
// the first paint (constructorSeed.ts). A return from the bank ends that order.
try {
  if (seedWantsShowroomLook()) document.documentElement.classList.add("maika-order-glass");
  if (window.location.pathname.startsWith("/order-confirmation") || new URLSearchParams(window.location.search).has("payment")) forgetShowroomSeed();
} catch {
  /* never block the app */
}

createRoot(document.getElementById("root")!).render(<App />);
