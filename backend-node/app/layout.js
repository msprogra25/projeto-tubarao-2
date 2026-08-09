import './globals.css';

export const metadata = {
  title: 'PDV System',
  description: 'Minimal Next.js app for Vercel detection',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
