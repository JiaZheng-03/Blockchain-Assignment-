import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { WalletProvider } from './context/WalletContext.jsx';
import { ContractProvider } from './context/ContractContext.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WalletProvider>
      <ContractProvider>
        <App />
      </ContractProvider>
    </WalletProvider>
  </StrictMode>,
);
