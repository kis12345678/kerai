import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <AppLayout>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
          <TriangleAlert className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="mt-6 font-display text-3xl font-bold">404 — Route Not Found</h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          WRAITH scanned every known path and came up empty. This one doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
        >
          Return to Dashboard
        </Link>
      </div>
    </AppLayout>
  );
};

export default NotFound;
