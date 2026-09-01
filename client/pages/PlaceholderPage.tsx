import { LucideIcon, Construction } from "lucide-react";
import AppLayout from "@/components/layout/AppLayout";

export default function PlaceholderPage({
  title,
  description,
  icon: Icon = Construction,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <AppLayout>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold sm:text-3xl">{title}</h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">{description}</p>
        <p className="mt-6 rounded-full border border-border bg-card px-4 py-2 text-xs font-mono text-muted-foreground">
          This module isn't wired up yet — keep prompting to build it out.
        </p>
      </div>
    </AppLayout>
  );
}
