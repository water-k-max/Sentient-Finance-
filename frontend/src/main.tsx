import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ContractsProvider } from "./context/ContractsContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ContractsProvider>
      <App />
    </ContractsProvider>
  </React.StrictMode>
);
