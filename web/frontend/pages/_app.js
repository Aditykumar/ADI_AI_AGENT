import '../styles/globals.css';
import { AuthProvider } from '../contexts/AuthContext';
import { Toaster } from 'react-hot-toast';

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <Component {...pageProps} />
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
          success: { iconTheme: { primary: '#22c55e', secondary: '#0f172a' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#0f172a' } },
        }}
      />
    </AuthProvider>
  );
}
