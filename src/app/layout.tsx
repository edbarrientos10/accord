import type { Metadata } from 'next';
import { WorkspaceFrame } from '../components/workspace/frame';
import { ThemeProvider } from '../components/theme-provider';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/latin-800.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Accord — shared work, clearly held',
  description: 'Outcomes, next actions, authority, and evidence in one shared workspace.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/brand/accord-favicon-v2.ico', sizes: '16x16 32x32 48x48' },
      { url: '/brand/accord-icon-32-v2.png', type: 'image/png', sizes: '32x32' },
      { url: '/brand/accord-icon-192-v2.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/brand/accord-icon-180-v2.png', sizes: '180x180' }],
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            // Resolve before paint so saved preferences never flash the opposite theme.
            __html: `(function(){var t='system';try{var s=localStorage.getItem('accord.theme.v1');if(s==='light'||s==='dark')t=s}catch(e){}var r=document.documentElement;r.dataset.themePreference=t;r.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t})()`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <WorkspaceFrame>{children}</WorkspaceFrame>
        </ThemeProvider>
      </body>
    </html>
  );
}
