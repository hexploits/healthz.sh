import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeToggle } from "./theme-toggle";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const brandName = process.env.NEXT_PUBLIC_COMPANY_NAME || "healthz.sh";

export const metadata: Metadata = {
  title: `${brandName} - Status`,
  description: `${brandName} multi-region health check dashboard`,
};

const themeScript = `
(function(){
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
})();
`;

const companyName = process.env.NEXT_PUBLIC_COMPANY_NAME;
const companyUrl = process.env.NEXT_PUBLIC_COMPANY_URL;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${inter.className} bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen transition-colors flex flex-col`}
      >
        <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
          {companyUrl ? (
            <a
              href={companyUrl}
              className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity"
            >
              {companyName || "Status"}
            </a>
          ) : (
            <a href="/" className="text-xl font-bold tracking-tight">
              {companyName || "Status"}
            </a>
          )}
          <ThemeToggle />
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full">{children}</main>
        <footer className="border-t border-gray-200 dark:border-gray-800 px-6 py-4 flex justify-center">
          <a
            href="https://github.com/hexploits/healthz.sh"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </footer>
      </body>
    </html>
  );
}
