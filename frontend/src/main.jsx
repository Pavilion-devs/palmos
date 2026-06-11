import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Solana web3.js / wallet-adapter rely on a global Buffer in the browser.
globalThis.Buffer = globalThis.Buffer ?? Buffer

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
