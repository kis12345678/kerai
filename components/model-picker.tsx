"use client";

import { useEffect, useState } from "react";
import { LOCAL_MODELS, CLOUD_MODELS, type ModelProvider } from "@/lib/models";

type ProviderAvailability = Record<Exclude<ModelProvider, "ollama">, boolean>;

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [availability, setAvailability] = useState<ProviderAvailability>({
    openrouter: false,
    aihubmix: false,
    requesty: false,
  });

  useEffect(() => {
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data) =>
        setAvailability({
          openrouter: Boolean(data.openrouter),
          aihubmix: Boolean(data.aihubmix),
          requesty: Boolean(data.requesty),
        })
      )
      .catch(() => {});
  }, []);

  const availableCloudModels = CLOUD_MODELS.filter(
    (m) => m.provider !== "ollama" && availability[m.provider]
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-[55vw] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-white/30 hover:bg-white/10 transition-colors sm:max-w-none"
    >
      <optgroup label="Local (Ollama)">
        {LOCAL_MODELS.map((m) => (
          <option key={m.id} value={m.id} className="bg-zinc-900">
            {m.label} — {m.vendor}
          </option>
        ))}
      </optgroup>
      {availableCloudModels.length > 0 && (
        <optgroup label="Cloud (leaves the machine)">
          {availableCloudModels.map((m) => (
            <option key={m.id} value={m.id} className="bg-zinc-900">
              {m.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
