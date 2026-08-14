import { AppShell } from './components/shell/AppShell';
import { ToastProvider } from './components/ui/Toast';

export function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
